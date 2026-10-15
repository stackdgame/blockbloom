'use strict';
/* BlockBloom wiring: game state, power-ups, revive/interstitial ad flows,
 * buttons. Browser only; loads after all other js files. */
(function () {
  var BB = globalThis.BlockBloom;
  var game = BB.game;
  var generator = BB.generator;
  var ads = BB.ads;
  var monetization = BB.monetization;
  var ui = BB.ui;
  // Fallback defaults if experiments.js failed to load (stale cached page):
  // control variants, so behavior stays sane.
  var experiments = BB.experiments || {
    getVariant: function (name) {
      var defaults = { pity_threshold: '12', ramp_on: 'on', nearbest_gap: '150', inter_gap_min: '3' };
      return defaults[name] || null;
    },
    listExperiments: function () { return []; }
  };
  var sound = new BB.audio.SoundFX();

  var BEST_KEY = 'bb_best';
  var BEST_MOVES_KEY = 'bb_best_moves';
  var CLEAR_ANIM_MS = 200;

  var provider = new ads.DemoAdsProvider();
  ads.demo = provider;

  var state = game.createGame();
  var busy = false;      // true while a clear animation is playing
  var hammerArmed = false;
  var expVars = { pityThreshold: 12, rampEnabled: true, nearBestGap: 150, interGapMs: 3 * 60 * 1000 };

  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(state.best)); } catch (e) {}
  }
  function loadBestMoves() {
    try { return parseInt(localStorage.getItem(BEST_MOVES_KEY) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBestMoves() {
    try { localStorage.setItem(BEST_MOVES_KEY, String(state.bestMoves)); } catch (e) {}
  }
  state.best = loadBest();
  state.bestMoves = loadBestMoves();

  /* Best-pace indicator: gold score glow while the current run is scoring
   * faster per move than the record run did. Honest, from real numbers. */
  function isOnPace() {
    if (!state.best || !state.bestMoves || state.moves === 0) return false;
    return (state.score / state.moves) > (state.best / state.bestMoves);
  }

  /* ---------------- game flow ---------------- */
  function newGame() {
    var keepBest = state.best;
    var keepBestMoves = state.bestMoves;
    state = game.createGame();
    state.best = keepBest;
    state.bestMoves = keepBestMoves;
    state.exp = {
      pityThreshold: expVars.pityThreshold,
      rampEnabled: expVars.rampEnabled
    };
    busy = false;
    hammerArmed = false;
    ui.setHammerArmed(false);
    ui.endFever();
    ui.setPaceHot(false);
    game.dealTray(state);
    monetization.stampLastPlay(Date.now());
    monetization.logEvent('run_start', {});
    ui.renderAll();
    ui.renderDailyGoal();
    ui.hideGameOver();
  }

  function handlePlace(trayIdx, r, c) {
    if (busy || state.gameOver) return;
    var feverBefore = game.isFeverActive(state);
    var res = game.placePiece(state, trayIdx, r, c);
    if (!res.ok) { ui.renderTray(); return; }

    busy = true;
    sound.place();
    ui.renderBoard();
    ui.flashPlaced(res.placedCells);
    ui.renderTray();
    ui.updateScore(true);
    ui.setPaceHot(isOnPace());

    // Fever trigger: the streak just completed.
    if (!feverBefore && game.isFeverActive(state)) {
      monetization.logEvent('fever_start', { score: state.score });
      sound.combo(3);
      ui.startFever(game.FEVER_DURATION_MS);
      ui.toast('FEVER! Double clear points for 30 seconds.');
    }

    if (res.lines > 0) {
      // Daily goal + lifetime lines + theme unlocks.
      var dg = monetization.progressDailyGoal(res.lines, Date.now());
      var unlocked = monetization.addLifetimeLines(res.lines);
      ui.renderDailyGoal();
      if (dg.completed) {
        ui.toast('Daily goal complete! Tap the bar to claim +3 hammers.');
      } else if (unlocked.length) {
        var names = unlocked.map(function (id) { return monetization.themeById(id).name; });
        ui.toast('New theme unlocked: ' + names.join(', ') + '! Tap the palette to try it.');
      }

      sound.clear(res.lines);
      if (state.combo >= 2) sound.combo(state.combo);
      ui.animateClears(res.clearedPreview, res.lines, state.combo, res.gained);
      setTimeout(function () {
        game.applyClear(state, res.clears);
        ui.renderBoard();
        busy = false;
        afterMove();
      }, CLEAR_ANIM_MS);
    } else {
      ui.floatScore(res.gained);
      busy = false;
      afterMove();
    }
  }

  function afterMove() {
    if (state.gameOver) return;
    if (state.tray.every(function (p) { return p === null; })) {
      game.dealTray(state);
      ui.renderTray();
      monetization.logEvent('deal', { moves: state.moves });
    }
    if (game.checkGameOver(state)) onGameOver();
  }

  function showGameOverPanel() {
    var gap = state.best - state.score;
    ui.showGameOver({
      score: state.score,
      best: state.best,
      revivesLeft: monetization.MAX_REVIVES_PER_RUN - state.revivesUsed,
      reviveCost: monetization.reviveAdCost(state, Date.now()),
      freeRevive: state.revivesUsed === 0 && monetization.isFreeReviveAvailable(Date.now()),
      nearBestGap: (gap > 0 && gap <= expVars.nearBestGap) ? gap : 0
    });
  }

  function onGameOver() {
    state.gameOver = true;
    hammerArmed = false;
    ui.setHammerArmed(false);
    ui.endFever();
    ui.setPaceHot(false);
    if (state.score > state.best) {
      state.best = state.score;
      state.bestMoves = state.moves;
      saveBest();
      saveBestMoves();
    }
    monetization.logEvent('game_over', { score: state.score, moves: state.moves });
    showGameOverPanel();
    sound.gameover();

    // Interstitial, smart-paced: only after long-enough runs, with gaps,
    // per-session caps, and suppression after recent rewarded ads.
    var runSec = (Date.now() - state.runStart) / 1000;
    if (ads.AdPolicy.shouldShowInterstitial(runSec, { gapMs: expVars.interGapMs })) {
      setTimeout(function () {
        if (!state.gameOver) return;
        ads.AdPolicy.markShown();
        monetization.logEvent('ad_shown', { slot: 'interstitial' });
        provider.showInterstitial().then(function () {
          monetization.logEvent('ad_closed', { slot: 'interstitial' });
        });
      }, 800);
    }
  }

  /* ---------------- revive (rewarded, escalating) ----------------
   * 1st revive costs 1 ad view, 2nd costs 2. Any skip aborts the revive. */
  async function onReviveClick() {
    if (busy) return;
    // Free daily revive: first revive of the day costs no ad.
    if (state.revivesUsed === 0 && monetization.isFreeReviveAvailable(Date.now())) {
      monetization.useFreeRevive(Date.now());
      monetization.logEvent('free_revive_used', { score: state.score });
      ui.hideGameOver();
      doRevive(0);
      return;
    }
    var cost = monetization.reviveAdCost(state, Date.now());
    ui.hideGameOver();
    for (var i = 0; i < cost; i++) {
      monetization.logEvent('ad_shown', { slot: 'revive', view: i + 1, of: cost });
      var res = await provider.showRewarded('revive');
      if (res !== 'completed') {
        monetization.logEvent('ad_skipped', { slot: 'revive', view: i + 1, of: cost });
        showGameOverPanel();
        return;
      }
      monetization.logEvent('ad_completed', { slot: 'revive', view: i + 1, of: cost });
      ads.AdPolicy.recordRewarded();
    }
    doRevive(cost);
  }

  function doRevive(cost) {
    var r = monetization.reviveGame(state);
    if (r.ok) {
      monetization.logEvent('revive_used', { method: r.method, score: state.score, cost: cost, free: cost === 0 });
      sound.revive();
      ui.renderAll();
      ui.toast(cost === 0
        ? 'Free revive! Your first one today is on the house.'
        : 'Back in bloom. Your score stayed exactly where it was.');
    } else {
      showGameOverPanel(); // revive limit reached
    }
  }

  /* ---------------- power-ups ---------------- */
  async function refillPowerup(kind) {
    if (busy) return;
    monetization.logEvent('ad_shown', { slot: 'powerup_' + kind });
    var res = await provider.showRewarded('powerup_' + kind);
    if (res === 'completed') {
      var total = monetization.addPowerups(kind, monetization.POWERUP_REFILL_AMOUNT);
      monetization.logEvent('ad_completed', { slot: 'powerup_' + kind });
      ads.AdPolicy.recordRewarded();
      monetization.logEvent('powerup_earned', { kind: kind, amount: monetization.POWERUP_REFILL_AMOUNT, total: total });
      sound.powerup();
      ui.renderPowerups();
      ui.toast('+3 ' + (kind === 'hammer' ? 'hammers' : 'undos') + '. Go bloom.');
    } else {
      monetization.logEvent('ad_skipped', { slot: 'powerup_' + kind });
    }
  }

  function onHammerClick() {
    if (busy || state.gameOver) return;
    if (monetization.getPowerups('hammer') <= 0) { refillPowerup('hammer'); return; }
    hammerArmed = !hammerArmed;
    ui.setHammerArmed(hammerArmed);
    if (hammerArmed) ui.toast('Tap a filled cell to smash it.');
  }

  function onUndoClick() {
    if (busy || state.gameOver) return;
    if (monetization.getPowerups('undo') <= 0) { refillPowerup('undo'); return; }
    if (state.history.length === 0) { ui.toast('Nothing to undo yet.'); return; }
    if (!monetization.usePowerup('undo')) return;
    game.undo(state);
    ui.renderAll();
    sound.place();
    ui.toast('Move undone. Piece returned to the tray.');
  }

  function onBoardTap(r, c) {
    if (!hammerArmed || busy || state.gameOver) return;
    if (state.board[r][c] === 0) { ui.toast('That cell is already empty.'); return; }
    if (!monetization.usePowerup('hammer')) { refillPowerup('hammer'); return; }
    game.hammerCell(state, r, c);
    hammerArmed = false;
    ui.setHammerArmed(false);
    ui.renderBoard();
    ui.renderPowerups();
    sound.clear(1);
    monetization.logEvent('powerup_used', { kind: 'hammer' });
  }

  /* ---------------- themes ---------------- */
  function onThemePick(id) {
    if (monetization.setTheme(id)) {
      ui.applyTheme(id);
      ui.renderThemes();
      sound.powerup();
      ui.toast(monetization.themeById(id).name + ' theme on.');
    }
  }

  /* ---------------- daily goal claim (rewarded) ---------------- */
  async function onGoalClaim() {
    if (busy) return;
    monetization.logEvent('ad_shown', { slot: 'daily_goal' });
    var res = await provider.showRewarded('daily_goal');
    if (res === 'completed') {
      if (monetization.claimDailyGoal(Date.now())) {
        monetization.logEvent('ad_completed', { slot: 'daily_goal' });
        ads.AdPolicy.recordRewarded();
        sound.powerup();
        ui.hideGoalClaim();
        ui.renderDailyGoal();
        ui.renderPowerups();
        ui.toast('+' + monetization.DAILY_GOAL_REWARD + ' hammers. See you tomorrow.');
      } else {
        ui.hideGoalClaim();
      }
    } else {
      monetization.logEvent('ad_skipped', { slot: 'daily_goal' });
      ui.hideGoalClaim();
    }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    // Apply the saved block theme before first paint.
    ui.applyTheme(monetization.getTheme());
    // A/B cohorts: deterministic per player, exposures logged for analysis.
    expVars = {
      pityThreshold: parseInt(experiments.getVariant('pity_threshold'), 10) || 12,
      rampEnabled: experiments.getVariant('ramp_on') === 'on',
      nearBestGap: parseInt(experiments.getVariant('nearbest_gap'), 10) || 150,
      interGapMs: (parseInt(experiments.getVariant('inter_gap_min'), 10) || 3) * 60 * 1000
    };
    experiments.listExperiments().forEach(function (name) {
      monetization.logEvent('exp_exposure', { exp: name, variant: experiments.getVariant(name) });
    });
    ads.AdPolicy.newSession();

    ui.init({
      getState: function () { return state; },
      game: game,
      sound: sound,
      onPlace: handlePlace,
      onBoardTap: onBoardTap,
      isBusy: function () { return busy; },
      isHammerArmed: function () { return hammerArmed; },
      onThemePick: onThemePick
    });

    $('btn-restart').addEventListener('click', newGame);
    $('btn-again').addEventListener('click', newGame);
    $('btn-revive').addEventListener('click', onReviveClick);
    $('btn-hammer').addEventListener('click', onHammerClick);
    $('btn-undo').addEventListener('click', onUndoClick);
    $('btn-hammer-refill').addEventListener('click', function () { refillPowerup('hammer'); });
    $('btn-undo-refill').addEventListener('click', function () { refillPowerup('undo'); });
    $('btn-theme').addEventListener('click', function () { ui.showThemeSheet(); });
    $('btn-theme-close').addEventListener('click', function () { ui.hideThemeSheet(); });

    // Daily goal bar: tap to claim when complete.
    $('daily-goal-wrap').addEventListener('click', function () {
      var g = monetization.getDailyGoal(Date.now());
      if (g.lines >= monetization.DAILY_GOAL_LINES && !g.claimed) ui.showGoalClaim();
    });
    $('btn-goal-claim').addEventListener('click', onGoalClaim);
    $('btn-goal-later').addEventListener('click', function () { ui.hideGoalClaim(); });
    $('btn-mute').addEventListener('click', function () {
      var muted = sound.toggle();
      $('btn-mute').textContent = muted ? '🔇' : '🔊';
      $('btn-mute').setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    });

    // Board taps (hammer targeting).
    $('board').addEventListener('click', function (e) {
      var t = e.target.closest('.cell');
      if (!t) return;
      onBoardTap(parseInt(t.dataset.r, 10), parseInt(t.dataset.c, 10));
    });

    if (sound.isMuted()) {
      $('btn-mute').textContent = '🔇';
      $('btn-mute').setAttribute('aria-label', 'Unmute sound');
    }

    // First user gesture unlocks WebAudio on mobile.
    window.addEventListener('pointerdown', function unlock() {
      try { sound._ensure(); } catch (e) {}
      window.removeEventListener('pointerdown', unlock);
    });

    // Win-back: returning after 48h+ away earns a free hammer, no ad.
    var wb = monetization.maybeWinbackGrant(Date.now());
    newGame();
    if (wb.granted) {
      ui.renderPowerups();
      ui.toast('Welcome back! A free hammer is yours.');
    }
  }

  function $(id) { return document.getElementById(id); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
