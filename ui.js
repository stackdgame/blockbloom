'use strict';
/* BlockBloom UI: rendering, drag and drop (Pointer Events, mouse + touch),
 * animations, panels. Talks to pure logic in game.js; never reimplements it.
 * Browser only. */
(function () {
  var COLORS = {
    1: '#F2789F', // rose
    2: '#F2A93B', // marigold
    3: '#46BD87', // clover
    4: '#5CA8E8', // sky
    5: '#A37FE0', // violet
    6: '#E86A7A'  // berry
  };
  var TRAY_CELL = 20; // px per cell for tray pieces (exact, for drag math)

  var api = {};
  var ctx = null; // { getState(), sound, onPlace, onBoardTap, isBusy }
  var els = {};
  var drag = null;

  function $(id) { return document.getElementById(id); }

  function state() { return ctx.getState(); }

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

  function pieceGrid(piece, cellPx) {
    var g = document.createElement('div');
    g.className = 'piece-grid';
    g.style.gridTemplateColumns = 'repeat(' + piece.w + ', ' + cellPx + 'px)';
    g.style.gridTemplateRows = 'repeat(' + piece.h + ', ' + cellPx + 'px)';
    var filled = {};
    piece.cells.forEach(function (cell) { filled[cell[0] + ',' + cell[1]] = true; });
    for (var r = 0; r < piece.h; r++) {
      for (var c = 0; c < piece.w; c++) {
        var d = document.createElement('div');
        if (filled[r + ',' + c]) d.className = 'pcell c' + piece.color;
        else d.className = 'pcell empty';
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
        wrap.appendChild(pieceGrid(piece, TRAY_CELL));
        wrap.addEventListener('pointerdown', function (e) { startDrag(e, slot, piece); });
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
    var dur = 450;
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
    renderBoard();
    renderTray();
    updateScore(false);
    renderPowerups();
  }

  /* ---------------- drag and drop ---------------- */
  function boardMetrics() {
    var rect = els.board.getBoundingClientRect();
    return { rect: rect, cell: rect.width / 8 };
  }

  function startDrag(e, slotEl, piece) {
    if (drag || ctx.isBusy() || state().gameOver) return;
    var st = state();
    var trayIdx = els.tray.indexOf(slotEl);
    if (trayIdx < 0 || st.tray[trayIdx] !== piece) return; // stale
    e.preventDefault();

    var gridEl = slotEl.querySelector('.piece-grid');
    var gridRect = gridEl.getBoundingClientRect();
    var bm = boardMetrics();
    var bs = bm.cell;
    var scale = bs / TRAY_CELL;
    var grabX = (e.clientX - gridRect.left) * scale;
    var grabY = (e.clientY - gridRect.top) * scale;

    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.appendChild(pieceGrid(piece, bs));
    ghost.style.left = (e.clientX - grabX) + 'px';
    ghost.style.top = (e.clientY - grabY) + 'px';
    document.body.appendChild(ghost);
    gridEl.classList.add('drag-src');

    drag = {
      trayIdx: trayIdx,
      piece: piece,
      ghost: ghost,
      srcGrid: gridEl,
      grabX: grabX,
      grabY: grabY,
      target: null
    };

    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', onDragCancel, { once: true });
  }

  function onDragMove(e) {
    if (!drag) return;
    e.preventDefault();
    drag.ghost.style.left = (e.clientX - drag.grabX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.grabY) + 'px';

    var bm = boardMetrics();
    var bs = bm.cell;
    var r0 = Math.round((e.clientY - drag.grabY - bm.rect.top) / bs);
    var c0 = Math.round((e.clientX - drag.grabX - bm.rect.left) / bs);
    var legal = ctx.game.canPlace(state().board, drag.piece, r0, c0);

    drag.target = { r: r0, c: c0, legal: legal };
    renderPreview(drag.piece, r0, c0, legal, bs);
  }

  function renderPreview(piece, r0, c0, legal, bs) {
    els.preview.innerHTML = '';
    for (var i = 0; i < piece.cells.length; i++) {
      var r = r0 + piece.cells[i][0];
      var c = c0 + piece.cells[i][1];
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      var d = document.createElement('div');
      d.className = 'preview-cell c' + piece.color + (legal ? ' ok' : ' no');
      d.style.left = (c * bs + 2) + 'px';
      d.style.top = (r * bs + 2) + 'px';
      d.style.width = (bs - 4) + 'px';
      d.style.height = (bs - 4) + 'px';
      els.preview.appendChild(d);
    }
  }

  function clearDragVisuals() {
    if (!drag) return;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    drag.srcGrid.classList.remove('drag-src');
    els.preview.innerHTML = '';
  }

  function onDragEnd(e) {
    if (!drag) return;
    window.removeEventListener('pointermove', onDragMove);
    var d = drag;
    drag = null;
    clearDragVisuals();
    if (d.target && d.target.legal && !ctx.isBusy() && !state().gameOver) {
      ctx.onPlace(d.trayIdx, d.target.r, d.target.c);
    } else {
      renderTray(); // snap back
    }
  }

  function onDragCancel() {
    if (!drag) return;
    window.removeEventListener('pointermove', onDragMove);
    drag = null;
    clearDragVisuals();
    renderTray();
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
    var bm = boardMetrics();
    var bs = bm.cell;
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
        p.style.background = COLORS[cell.color] || '#F2789F';
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

  /* ---------------- panels ---------------- */
  function showGameOver(info) {
    els.goScore.textContent = String(info.score);
    els.goBest.textContent = String(info.best);
    els.reviveLabel.textContent = info.revivesLeft > 0
      ? 'Watch ad to keep going (' + info.revivesLeft + ' left)'
      : 'Revive used up';
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
  api.COLORS = COLORS;

  var root = typeof globalThis !== 'undefined' ? globalThis : this;
  root.BlockBloom = root.BlockBloom || {};
  root.BlockBloom.ui = api;
})();
