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
  var sound = new BB.audio.SoundFX();

  var BEST_KEY = 'bb_best';
  var CLEAR_ANIM_MS = 200;

  var provider = new ads.DemoAdsProvider();
  ads.demo = provider;

  var state = game.createGame();
  var busy = false;      // true while a clear animation is playing
  var hammerArmed = false;

  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(state.best)); } catch (e) {}
  }
  state.best = loadBest();

  /* ---------------- game flow ---------------- */
  function newGame() {
    var keepBest = state.best;
    state = game.createGame();
    state.best = keepBest;
    busy = false;
    hammerArmed = false;
    ui.setHammerArmed(false);
    game.dealTray(state);
    monetization.logEvent('run_start', {});
    ui.renderAll();
    ui.hideGameOver();
  }

  function handlePlace(trayIdx, r, c) {
    if (busy || state.gameOver) return;
    var res = game.placePiece(state, trayIdx, r, c);
    if (!res.ok) { ui.renderTray(); return; }

    busy = true;
    sound.place();
    ui.renderBoard();
    ui.flashPlaced(res.placedCells);
    ui.renderTray();
    ui.updateScore(true);

    if (res.lines > 0) {
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
    ui.showGameOver({
      score: state.score,
      best: state.best,
      revivesLeft: monetization.MAX_REVIVES_PER_RUN - state.revivesUsed
    });
  }

  function onGameOver() {
    state.gameOver = true;
    hammerArmed = false;
    ui.setHammerArmed(false);
    if (state.score > state.best) { state.best = state.score; saveBest(); }
    monetization.logEvent('game_over', { score: state.score, moves: state.moves });
    ads.AdPolicy.recordGameOver();
    showGameOverPanel();
    sound.gameover();

    // Interstitial, frequency-capped, only after game over. Never mid-play.
    var runSec = (Date.now() - state.runStart) / 1000;
    if (ads.AdPolicy.shouldShowInterstitial(runSec)) {
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

  /* ---------------- revive (rewarded) ---------------- */
  async function onReviveClick() {
    if (busy) return;
    ui.hideGameOver();
    monetization.logEvent('ad_shown', { slot: 'revive' });
    var res = await provider.showRewarded('revive');
    if (res === 'completed') {
      monetization.logEvent('ad_completed', { slot: 'revive' });
      var r = monetization.reviveGame(state);
      if (r.ok) {
        monetization.logEvent('revive_used', { method: r.method, score: state.score });
        sound.revive();
        ui.renderAll();
        ui.toast('Back in bloom. Your score stayed exactly where it was.');
      } else {
        showGameOverPanel(); // revive limit reached
      }
    } else {
      monetization.logEvent('ad_skipped', { slot: 'revive' });
      showGameOverPanel();
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

  /* ---------------- boot ---------------- */
  function boot() {
    ui.init({
      getState: function () { return state; },
      game: game,
      sound: sound,
      onPlace: handlePlace,
      onBoardTap: onBoardTap,
      isBusy: function () { return busy; },
      isHammerArmed: function () { return hammerArmed; }
    });

    $('btn-restart').addEventListener('click', newGame);
    $('btn-again').addEventListener('click', newGame);
    $('btn-revive').addEventListener('click', onReviveClick);
    $('btn-hammer').addEventListener('click', onHammerClick);
    $('btn-undo').addEventListener('click', onUndoClick);
    $('btn-hammer-refill').addEventListener('click', function () { refillPowerup('hammer'); });
    $('btn-undo-refill').addEventListener('click', function () { refillPowerup('undo'); });
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

    newGame();
  }

  function $(id) { return document.getElementById(id); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
