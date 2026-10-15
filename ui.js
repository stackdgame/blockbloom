'use strict';
/* BlockBloom UI: rendering, drag and drop (Pointer Events, mouse + touch),
 * animations, panels. Talks to pure logic in game.js; never reimplements it.
 * Browser only.
 *
 * PIXEL-EXACT BOARD: layoutBoard() computes CELL (integer px) from the
 * available width and sizes #board-wrap to exactly CELL*8. The grid uses
 * repeat(8, var(--cell)) with NO padding, so drag math (CELL px per cell)
 * always matches rendered cells. Preview/fx layers are inset:0 inside the
 * exactly-sized wrap, so overlays align perfectly too.
 */
(function () {
  var COLORS = {
    1: '#ff5c7a',
    2: '#ff9f43',
    3: '#2ed573',
    4: '#3aa0ff',
    5: '#a55eea',
    6: '#ffd32a',
    7: '#1dd1a1',
    8: '#fd79a8'
  };
  var TRAY_CELL = 20; // px per cell for tray pieces (exact, for drag math)
  var CELL = 0;       // exact px per board cell; set by layoutBoard()

  var api = {};
  var ctx = null; // { getState(), sound, onPlace, onBoardTap, isBusy }
  var els = {};
  var drag = null;

  function $(id) { return document.getElementById(id); }

  function state() { return ctx.getState(); }

  /* ---------------- exact board layout ---------------- */
  function layoutBoard() {
    var avail = Math.min($('game-area').clientWidth || 360, 420);
    var cell = Math.max(24, Math.floor(avail / 8));
    CELL = cell;
    var px = cell * 8;
    els.boardWrap.style.width = px + 'px';
    els.boardWrap.style.height = px + 'px';
    els.board.style.setProperty('--cell', cell + 'px');
  }

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutBoard, 150);
  }

  function init(c) {
    ctx = c;
    els.board = $('board');
    els.preview = $('preview-layer');
    els.fx = $('fx-layer');
    els.boardWrap = $('board-wrap');
    els.tray = [$('tray-0'), $('tray-1'), $('tray-2')];
    els.score = $('score');
    els.best = $('best');
    els.hammerCount = $('hammer-count');
    els.undoCount = $('undo-count');
    els.combo = $('combo-popup');
    els.toast = $('toast');
    els.gameover = $('gameover-overlay');
    els.goScore = $('go-score');
    els.goBest = $('go-best');
    els.reviveLabel = $('revive-label');
    layoutBoard();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    renderAll();
  }

  /* ---------------- rendering ---------------- */
  function cellEl(r, c, color) {
    var d = document.createElement('div');
    d.className = 'cell' + (color ? ' filled c' + color : '');
    d.dataset.r = r;
    d.dataset.c = c;
    return d;
  }

  function renderBoard() {
    var st = state();
    var frag = document.createDocumentFragment();
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        frag.appendChild(cellEl(r, c, st.board[r][c]));
      }
    }
    els.board.innerHTML = '';
    els.board.appendChild(frag);
    els.board.classList.toggle('armed', !!ctx.isHammerArmed && ctx.isHammerArmed());
  }

  function pieceGrid(piece, cellPx, ghostMode) {
    var g = document.createElement('div');
    g.className = 'piece-grid';
    g.style.gridTemplateColumns = 'repeat(' + piece.w + ', ' + cellPx + 'px)';
    g.style.gridTemplateRows = 'repeat(' + piece.h + ', ' + cellPx + 'px)';
    var filled = {};
    piece.cells.forEach(function (cell) { filled[cell[0] + ',' + cell[1]] = true; });
    for (var r = 0; r < piece.h; r++) {
      for (var c = 0; c < piece.w; c++) {
        var d = document.createElement('div');
        if (filled[r + ',' + c]) {
          d.className = 'pcell blk c' + piece.color;
          if (ghostMode) {
            d.style.width = cellPx + 'px';
            d.style.height = cellPx + 'px';
          }
        } else {
          d.className = 'pcell empty';
        }
        g.appendChild(d);
      }
    }
    return g;
  }

  function renderTray() {
    var st = state();
    for (var i = 0; i < 3; i++) {
      (function (slot, piece) {
        slot.innerHTML = '';
        slot.classList.toggle('empty', !piece);
        if (!piece) return;
        var wrap = document.createElement('div');
        wrap.className = 'tray-piece';
        wrap.appendChild(pieceGrid(piece, TRAY_CELL, false));
        wrap.addEventListener('pointerdown', function (e) { startDrag(e, slot, wrap, piece); });
        slot.appendChild(wrap);
      })(els.tray[i], st.tray[i]);
    }
  }

  var shownScore = 0;
  var scoreRaf = 0;
  function updateScore(animate) {
    var target = state().score;
    els.best.textContent = String(state().best);
    if (!animate) {
      shownScore = target;
      els.score.textContent = String(target);
      return;
    }
    cancelAnimationFrame(scoreRaf);
    var from = shownScore;
    var t0 = performance.now();
    var dur = 250;
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var v = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      els.score.textContent = String(v);
      if (k < 1) scoreRaf = requestAnimationFrame(step);
      else shownScore = target;
    }
    scoreRaf = requestAnimationFrame(step);
  }

  function renderPowerups() {
    var BB = globalThis.BlockBloom;
    els.hammerCount.textContent = String(BB.monetization.getPowerups('hammer'));
    els.undoCount.textContent = String(BB.monetization.getPowerups('undo'));
  }

  function renderAll() {
    layoutBoard();
    renderBoard();
    renderTray();
    updateScore(false);
    renderPowerups();
  }

  /* ---------------- drag and drop ---------------- */
  function sweepStrayGhosts() {
    var strays = document.querySelectorAll('.drag-ghost');
    for (var i = 0; i < strays.length; i++) {
      if (strays[i].parentNode) strays[i].parentNode.removeChild(strays[i]);
    }
    els.preview.innerHTML = '';
    lastPreviewKey = '';
  }

  function startDrag(e, slotEl, wrapEl, piece) {
    if (drag) {
      if (e.pointerId === drag.pointerId) endDragCommon(); // re-entrant: reset
      else return; // second finger: leave the active drag alone
    }
    sweepStrayGhosts(); // never leave a stuck ghost behind
    if (ctx.isBusy() || state().gameOver) return;
    var st = state();
    var trayIdx = els.tray.indexOf(slotEl);
    if (trayIdx < 0 || st.tray[trayIdx] !== piece) return; // stale
    e.preventDefault();

    // Pointer capture guarantees pointerup/pointercancel delivery on iOS.
    try { wrapEl.setPointerCapture(e.pointerId); } catch (err) {}

    var gridEl = wrapEl.querySelector('.piece-grid');
    var gridRect = gridEl.getBoundingClientRect();
    var bs = CELL; // exact board cell px
    var scale = bs / TRAY_CELL;
    var grabX = (e.clientX - gridRect.left) * scale;
    var grabY = (e.clientY - gridRect.top) * scale;

    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.appendChild(pieceGrid(piece, bs, true));
    ghost.style.left = (e.clientX - grabX) + 'px';
    ghost.style.top = (e.clientY - grabY) + 'px';
    document.body.appendChild(ghost);
    gridEl.classList.add('drag-src');

    drag = {
      pointerId: e.pointerId,
      trayIdx: trayIdx,
      piece: piece,
      ghost: ghost,
      srcGrid: gridEl,
      grabX: grabX,
      grabY: grabY,
      brect: els.board.getBoundingClientRect(), // cached: board never moves mid-drag
      target: null
    };
    lastPreviewKey = '';

    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
  }

  var lastPreviewKey = '';

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.ghost.style.left = (e.clientX - drag.grabX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.grabY) + 'px';

    var bs = CELL;
    var r0 = Math.round((e.clientY - drag.grabY - drag.brect.top) / bs);
    var c0 = Math.round((e.clientX - drag.grabX - drag.brect.left) / bs);
    var legal = ctx.game.canPlace(state().board, drag.piece, r0, c0);

    drag.target = { r: r0, c: c0, legal: legal };
    // Perf: rebuilding preview DOM every move janks on phones. Only
    // re-render when the target cell or legality actually changed.
    var key = r0 + ',' + c0 + ',' + (legal ? '1' : '0');
    if (key !== lastPreviewKey) {
      lastPreviewKey = key;
      renderPreview(drag.piece, r0, c0, legal);
    }
  }

  function renderPreview(piece, r0, c0, legal) {
    els.preview.innerHTML = '';
    var bs = CELL;
    for (var i = 0; i < piece.cells.length; i++) {
      var r = r0 + piece.cells[i][0];
      var c = c0 + piece.cells[i][1];
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      var d = document.createElement('div');
      d.className = 'preview-cell c' + piece.color + (legal ? ' ok' : ' no');
      d.style.left = (c * bs) + 'px';
      d.style.top = (r * bs) + 'px';
      d.style.width = bs + 'px';
      d.style.height = bs + 'px';
      els.preview.appendChild(d);
    }
  }

  function endDragCommon() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    var d = drag;
    drag = null;
    lastPreviewKey = '';
    return d;
  }

  // Illegal drop (or cancel): the ghost visibly flies back to its tray slot,
  // then the tray re-renders. The piece always comes home; nothing can stick.
  function snapBack(d) {
    d.srcGrid.classList.remove('drag-src');
    els.preview.innerHTML = '';
    var slot = els.tray[d.trayIdx];
    if (!slot) { finishSnapBack(d); return; }
    var r = slot.getBoundingClientRect();
    var tx = r.left + r.width / 2 - d.grabX;
    var ty = r.top + r.height / 2 - d.grabY;
    d.ghost.style.transition = 'left 0.18s ease-out, top 0.18s ease-out';
    d.ghost.style.left = tx + 'px';
    d.ghost.style.top = ty + 'px';
    setTimeout(function () { finishSnapBack(d); }, 190);
  }

  function finishSnapBack(d) {
    if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    renderTray();
  }

  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = endDragCommon();
    if (d.target && d.target.legal && !ctx.isBusy() && !state().gameOver) {
      if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      d.srcGrid.classList.remove('drag-src');
      els.preview.innerHTML = '';
      ctx.onPlace(d.trayIdx, d.target.r, d.target.c);
    } else {
      snapBack(d);
    }
  }

  function onDragCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = endDragCommon();
    snapBack(d);
  }

  /* ---------------- animations and feedback ---------------- */
  function flashPlaced(cells) {
    cells.forEach(function (cell) {
      var idx = cell[0] * 8 + cell[1];
      var el = els.board.children[idx];
      if (el) {
        el.classList.add('pop');
        setTimeout(function () { el.classList.remove('pop'); }, 260);
      }
    });
  }

  function petalBurst(clearedPreview) {
    var bs = CELL;
    var max = 42;
    var per = Math.max(1, Math.floor(max / Math.max(1, clearedPreview.length)));
    clearedPreview.forEach(function (cell) {
      var x = (cell.c + 0.5) * bs;
      var y = (cell.r + 0.5) * bs;
      var el = els.board.children[cell.r * 8 + cell.c];
      if (el) el.classList.add('blooming');
      for (var i = 0; i < per; i++) {
        var p = document.createElement('div');
        p.className = 'petal';
        p.style.background = COLORS[cell.color] || '#ff5c7a';
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        var ang = Math.random() * Math.PI * 2;
        var dist = 26 + Math.random() * 44;
        p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
        p.style.setProperty('--dy', (Math.sin(ang) * dist - 18).toFixed(1) + 'px');
        els.fx.appendChild(p);
        (function (node) {
          setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 750);
        })(p);
      }
    });
  }

  function floatScore(gained) {
    var d = document.createElement('div');
    d.className = 'float-score';
    d.textContent = '+' + gained;
    els.fx.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1100);
  }

  function comboPopup(combo) {
    if (combo < 2) return;
    els.combo.textContent = 'Combo x' + combo;
    els.combo.classList.remove('show');
    void els.combo.offsetWidth; // restart animation
    els.combo.classList.add('show');
  }

  function animateClears(clearedPreview, lines, combo, gained) {
    if (clearedPreview.length) petalBurst(clearedPreview);
    floatScore(gained);
    comboPopup(combo);
  }

  var toastTimer = 0;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2600);
  }

  /* ---------------- fever mode ---------------- */
  var feverTimer = 0;
  function startFever(durationMs) {
    els.boardWrap.classList.add('fever');
    var banner = $('fever-banner');
    banner.hidden = false;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    clearTimeout(feverTimer);
    feverTimer = setTimeout(endFever, durationMs || 30000);
  }
  function endFever() {
    clearTimeout(feverTimer);
    els.boardWrap.classList.remove('fever');
    $('fever-banner').hidden = true;
  }

  /* ---------------- best-pace indicator ---------------- */
  function setPaceHot(hot) {
    var box = $('score-box');
    if (box) box.classList.toggle('pace-hot', !!hot);
  }

  /* ---------------- daily goal ---------------- */
  function renderDailyGoal() {
    var BB = globalThis.BlockBloom;
    var g = BB.monetization.getDailyGoal(Date.now());
    var target = BB.monetization.DAILY_GOAL_LINES;
    var pct = Math.min(100, Math.round((g.lines / target) * 100));
    $('daily-goal-fill').style.width = pct + '%';
    var label = $('daily-goal-text');
    if (g.lines >= target && !g.claimed) {
      label.textContent = 'Goal complete! Tap to claim';
      $('daily-goal-wrap').classList.add('claimable');
    } else if (g.claimed) {
      label.textContent = 'Daily goal claimed';
      $('daily-goal-wrap').classList.remove('claimable');
    } else {
      label.textContent = 'Daily: ' + g.lines + '/' + target + ' lines';
      $('daily-goal-wrap').classList.remove('claimable');
    }
  }

  function showGoalClaim() {
    $('goal-overlay').hidden = false;
  }
  function hideGoalClaim() {
    $('goal-overlay').hidden = true;
  }

  /* ---------------- themes ---------------- */
  function applyTheme(id) {
    document.body.classList.remove('theme-neon', 'theme-pastel', 'theme-gold');
    if (id && id !== 'bloom') document.body.classList.add('theme-' + id);
  }

  function renderThemes() {
    var BB = globalThis.BlockBloom;
    var wrap = $('theme-swatches');
    wrap.innerHTML = '';
    var unlocked = BB.monetization.getUnlockedThemes();
    var current = BB.monetization.getTheme();
    var lifetime = BB.monetization.getLifetimeLines();
    BB.monetization.THEMES.forEach(function (t) {
      var ok = unlocked.indexOf(t.id) !== -1;
      var d = document.createElement('button');
      d.className = 'theme-swatch theme-prev-' + t.id + (ok ? '' : ' locked') + (t.id === current ? ' active' : '');
      d.setAttribute('aria-label', t.name + (ok ? '' : ', locked'));
      d.innerHTML = '<span class="sw">' +
        '<i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i>' +
        '</span><span class="tname">' + t.name + '</span>' +
        (ok ? '' : '<span class="tlock">' + t.lines + ' lines</span>');
      if (ok) {
        (function (id) {
          d.addEventListener('click', function () {
            if (ctx.onThemePick) ctx.onThemePick(id);
          });
        })(t.id);
      } else {
        d.disabled = true;
        d.title = 'Clear ' + t.lines + ' lifetime lines to unlock (' + lifetime + ' so far)';
      }
      wrap.appendChild(d);
    });
  }

  function showThemeSheet() {
    renderThemes();
    $('theme-overlay').hidden = false;
  }
  function hideThemeSheet() {
    $('theme-overlay').hidden = true;
  }
  function showGameOver(info) {
    els.goScore.textContent = String(info.score);
    els.goBest.textContent = String(info.best);
    // Near-best prompt: an honest, high-converting nudge when the player
    // died close to their record. Guarded for stale cached HTML.
    var near = $('go-nearbest');
    if (near) {
      if (info.nearBestGap > 0) {
        near.textContent = 'So close! Just ' + info.nearBestGap + ' points from your best.';
        near.hidden = false;
      } else {
        near.hidden = true;
      }
    }
    if (info.revivesLeft > 0) {
      if (info.freeRevive) {
        els.reviveLabel.textContent = 'Revive FREE (today\u2019s gift)';
      } else if (info.reviveCost > 1) {
        els.reviveLabel.textContent = 'Watch 2 ads for one last revive';
      } else {
        els.reviveLabel.textContent = 'Watch ad to keep going (' + info.revivesLeft + ' left)';
      }
    } else {
      els.reviveLabel.textContent = 'Revives used up';
    }
    $('btn-revive').disabled = info.revivesLeft <= 0;
    els.gameover.hidden = false;
  }

  function hideGameOver() {
    els.gameover.hidden = true;
  }

  function setHammerArmed(armed) {
    els.boardWrap.classList.toggle('hammer-armed', !!armed);
    renderBoard();
  }

  api.init = init;
  api.renderAll = renderAll;
  api.renderBoard = renderBoard;
  api.renderTray = renderTray;
  api.updateScore = updateScore;
  api.renderPowerups = renderPowerups;
  api.flashPlaced = flashPlaced;
  api.animateClears = animateClears;
  api.floatScore = floatScore;
  api.toast = toast;
  api.showGameOver = showGameOver;
  api.hideGameOver = hideGameOver;
  api.setHammerArmed = setHammerArmed;
  api.startFever = startFever;
  api.endFever = endFever;
  api.setPaceHot = setPaceHot;
  api.renderDailyGoal = renderDailyGoal;
  api.showGoalClaim = showGoalClaim;
  api.hideGoalClaim = hideGoalClaim;
  api.applyTheme = applyTheme;
  api.renderThemes = renderThemes;
  api.showThemeSheet = showThemeSheet;
  api.hideThemeSheet = hideThemeSheet;
  api.COLORS = COLORS;
  api.layoutBoard = layoutBoard;

  var root = typeof globalThis !== 'undefined' ? globalThis : this;
  root.BlockBloom = root.BlockBloom || {};
  root.BlockBloom.ui = api;
})();
