'use strict';
/* BlockBloom monetization: revive logic, power-up grants, remove-ads flag,
 * and an analytics stub. No DOM here; ad presentation lives in ads.js and
 * the async "watch ad then grant" flows live in main.js.
 *
 * Honest rules (SPEC 4.3): no device-data worth model, no hidden death
 * triggering, revive keeps 100% of score.
 */
(function () {
  function loadApi(path, globalName) {
    if (typeof require === 'function') {
      try { return require(path); } catch (e) { /* fall through to global */ }
    }
    if (typeof globalThis !== 'undefined' && globalThis.BlockBloom && globalThis.BlockBloom[globalName]) {
      return globalThis.BlockBloom[globalName];
    }
    throw new Error('BlockBloom ' + globalName + ' module is not loaded');
  }

  var game = loadApi('./game.js', 'game');
  var generator = loadApi('./generator.js', 'generator');

  var MAX_REVIVES_PER_RUN = 2; // 1st revive: 1 ad view, 2nd revive: 2 ad views
  var REVIVE_CLEAR_CELLS = 14; // used when history is too short for a snapshot restore
  var POWERUP_START_COUNT = 3;
  var POWERUP_REFILL_AMOUNT = 3;
  var ANALYTICS_RING_MAX = 100;
  var WINBACK_HOURS = 48;
  var WINBACK_HAMMERS = 1;

  /* Storage that works in browsers and in Node (in-memory fallback). */
  var memoryStore = {};
  function store() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* fall through */ }
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; },
      setItem: function (k, v) { memoryStore[k] = String(v); },
      removeItem: function (k) { delete memoryStore[k]; }
    };
  }

  /* ---------- analytics stub ----------
   * Every monetization event is logged to the console and to a localStorage
   * ring buffer (bb_analytics, max 100 entries). To forward to a real
   * analytics endpoint later, hook into logEvent(). */
  function logEvent(name, data) {
    var evt = { t: Date.now(), name: name, data: data || {} };
    try { console.log('[BlockBloom analytics]', name, evt.data); } catch (e) {}
    try {
      var s = store();
      var arr = JSON.parse(s.getItem('bb_analytics') || '[]');
      arr.push(evt);
      while (arr.length > ANALYTICS_RING_MAX) arr.shift();
      s.setItem('bb_analytics', JSON.stringify(arr));
    } catch (e) { /* storage unavailable: console log is enough */ }
    return evt;
  }

  function getAnalyticsEvents() {
    try {
      return JSON.parse(store().getItem('bb_analytics') || '[]');
    } catch (e) { return []; }
  }

  /* ---------- power-ups ---------- */
  function powerupKey(kind) { return 'bb_powerup_' + kind; }

  function getPowerups(kind) {
    var raw = store().getItem(powerupKey(kind));
    if (raw === null || raw === undefined) return POWERUP_START_COUNT;
    var n = parseInt(raw, 10);
    return isNaN(n) ? POWERUP_START_COUNT : n;
  }

  function setPowerups(kind, n) {
    store().setItem(powerupKey(kind), String(Math.max(0, n)));
  }

  function usePowerup(kind) {
    var n = getPowerups(kind);
    if (n <= 0) return false;
    setPowerups(kind, n - 1);
    return true;
  }

  function addPowerups(kind, amount) {
    var n = getPowerups(kind) + (amount || POWERUP_REFILL_AMOUNT);
    setPowerups(kind, n);
    return n;
  }

  /* ---------- remove-ads flag ----------
   * Default false. Purchase wiring is left for the native-wrapper phase;
   * when a purchase completes, setRemoveAds(true) disables interstitials. */
  function hasRemoveAds() {
    return store().getItem('bb_remove_ads') === '1';
  }

  function setRemoveAds(value) {
    store().setItem('bb_remove_ads', value ? '1' : '0');
  }

  /* ---------- revive ----------
   * Rewarded revive (player's choice, after watching ads):
   *  - max 2 revives per run; the 1st costs 1 ad view, the 2nd costs 2
   *  - restores the board to the state 3 moves ago (history snapshot taken
   *    before that placement), or clears REVIVE_CLEAR_CELLS random filled
   *    cells when fewer than 3 moves are in history
   *  - keeps 100% of the score (never takes score away)
   *  - combo resets to 0; tray is redealt fairly; gameOver clears */
  function reviveAdCost(state) {
    return state.revivesUsed === 0 ? 1 : 2;
  }
  function clearRandomCells(board, count, rng) {
    rng = rng || Math.random;
    var filled = [];
    for (var r = 0; r < game.BOARD_SIZE; r++) {
      for (var c = 0; c < game.BOARD_SIZE; c++) {
        if (board[r][c] !== 0) filled.push([r, c]);
      }
    }
    // Fisher-Yates shuffle with the provided rng for testability.
    for (var i = filled.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = filled[i]; filled[i] = filled[j]; filled[j] = tmp;
    }
    var n = Math.min(count, filled.length);
    for (var k = 0; k < n; k++) board[filled[k][0]][filled[k][1]] = 0;
    return n;
  }

  function reviveGame(state, rng) {
    if (state.revivesUsed >= MAX_REVIVES_PER_RUN) {
      return { ok: false, reason: 'revive-limit' };
    }
    state.revivesUsed += 1;
    var method;
    if (state.history.length >= 3) {
      var snap = state.history[state.history.length - 3];
      state.board = game.cloneBoard(snap.board);
      method = 'snapshot';
    } else {
      clearRandomCells(state.board, REVIVE_CLEAR_CELLS, rng);
      method = 'clear-cells';
    }
    state.combo = 0;
    state.gameOver = false;
    state.history = []; // avoid undoing back into the pre-revive dead end
    state.tray = generator.drawTray(state.board, rng);
    // score is intentionally untouched: revive keeps 100% of score.
    return { ok: true, method: method };
  }

  /* ---------- win-back ----------
   * If the player returns after more than WINBACK_HOURS away, grant a free
   * hammer on open. Honest retention: a gift, never an ad. */
  var LAST_PLAY_KEY = 'bb_last_play';

  function getLastPlay() {
    var raw = store().getItem(LAST_PLAY_KEY);
    var n = parseInt(raw || '0', 10);
    return isNaN(n) ? 0 : n;
  }

  function stampLastPlay(nowMs) {
    try { store().setItem(LAST_PLAY_KEY, String(typeof nowMs === 'number' ? nowMs : Date.now())); } catch (e) { /* ignore */ }
  }

  function maybeWinbackGrant(nowMs) {
    var now = (typeof nowMs === 'number') ? nowMs : Date.now();
    var last = getLastPlay();
    if (!last) return { granted: false, reason: 'first-play' };
    if (now - last > WINBACK_HOURS * 60 * 60 * 1000) {
      addPowerups('hammer', WINBACK_HAMMERS);
      stampLastPlay(now);
      logEvent('winback_grant', { hammers: WINBACK_HAMMERS, hoursAway: Math.round((now - last) / 3600000) });
      return { granted: true, hammers: WINBACK_HAMMERS };
    }
    return { granted: false, reason: 'recent' };
  }

  var api = {
    MAX_REVIVES_PER_RUN: MAX_REVIVES_PER_RUN,
    REVIVE_CLEAR_CELLS: REVIVE_CLEAR_CELLS,
    POWERUP_START_COUNT: POWERUP_START_COUNT,
    POWERUP_REFILL_AMOUNT: POWERUP_REFILL_AMOUNT,
    WINBACK_HOURS: WINBACK_HOURS,
    logEvent: logEvent,
    getAnalyticsEvents: getAnalyticsEvents,
    getPowerups: getPowerups,
    setPowerups: setPowerups,
    usePowerup: usePowerup,
    addPowerups: addPowerups,
    hasRemoveAds: hasRemoveAds,
    setRemoveAds: setRemoveAds,
    clearRandomCells: clearRandomCells,
    reviveAdCost: reviveAdCost,
    reviveGame: reviveGame,
    getLastPlay: getLastPlay,
    stampLastPlay: stampLastPlay,
    maybeWinbackGrant: maybeWinbackGrant,
    _store: store // exposed for tests
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    var root = typeof globalThis !== 'undefined' ? globalThis : this;
    root.BlockBloom = root.BlockBloom || {};
    root.BlockBloom.monetization = api;
  }
})();
