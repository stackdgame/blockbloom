'use strict';
/* BlockBloom pure game logic. ZERO DOM access: this file must run in Node
 * (for tests) and in the browser. All rendering lives in ui.js.
 *
 * Scoring (single source of truth, SPEC 2.7):
 *   placeScore = cells placed * 1
 *   clearScore = clearedCells * 10 * linesCleared
 *   comboBonus = 50 * combo * linesCleared   (combo counts consecutive clearing moves)
 * Score is never taken away. Revive keeps 100% of score.
 */
(function () {
  function loadPieces() {
    if (typeof require === 'function') {
      try { return require('./pieces.js'); } catch (e) { /* fall through to global */ }
    }
    if (typeof globalThis !== 'undefined' && globalThis.BlockBloom && globalThis.BlockBloom.pieces) {
      return globalThis.BlockBloom.pieces;
    }
    throw new Error('BlockBloom pieces module is not loaded');
  }

  function loadGenerator() {
    if (typeof require === 'function') {
      try { return require('./generator.js'); } catch (e) { /* fall through to global */ }
    }
    if (typeof globalThis !== 'undefined' && globalThis.BlockBloom && globalThis.BlockBloom.generator) {
      return globalThis.BlockBloom.generator;
    }
    throw new Error('BlockBloom generator module is not loaded');
  }

  var BOARD_SIZE = 8;
  var HISTORY_LIMIT = 8;

  var SCORING = {
    PLACE_PER_CELL: 1,
    CLEAR_PER_CELL: 10,
    COMBO_PER_LINE: 50
  };

  function emptyBoard() {
    var b = [];
    for (var r = 0; r < BOARD_SIZE; r++) { b.push([0,0,0,0,0,0,0,0]); }
    return b;
  }

  function cloneBoard(board) {
    return board.map(function (row) { return row.slice(); });
  }

  function clonePiece(piece) {
    if (!piece) return null;
    return {
      name: piece.name,
      cells: piece.cells.map(function (c) { return [c[0], c[1]]; }),
      weight: piece.weight,
      color: piece.color,
      small: piece.small,
      w: piece.w,
      h: piece.h
    };
  }

  function cloneTray(tray) {
    return tray.map(clonePiece);
  }

  function createGame() {
    return {
      board: emptyBoard(),
      tray: [null, null, null],
      score: 0,
      combo: 0,
      best: 0,
      history: [],       // snapshots taken BEFORE each placement (max HISTORY_LIMIT)
      moves: 0,
      gameOver: false,
      revivesUsed: 0,
      runStart: Date.now()
    };
  }

  function inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  function canPlace(board, piece, row, col) {
    if (!piece) return false;
    for (var i = 0; i < piece.cells.length; i++) {
      var r = row + piece.cells[i][0];
      var c = col + piece.cells[i][1];
      if (!inBounds(r, c) || board[r][c] !== 0) return false;
    }
    return true;
  }

  function pieceHeight(piece) {
    var m = 0, i;
    for (i = 0; i < piece.cells.length; i++) if (piece.cells[i][0] > m) m = piece.cells[i][0];
    return m + 1;
  }

  function pieceWidth(piece) {
    var m = 0, i;
    for (i = 0; i < piece.cells.length; i++) if (piece.cells[i][1] > m) m = piece.cells[i][1];
    return m + 1;
  }

  /* Find all full rows and full columns. Clears are simultaneous: a cell that
   * sits at a row/col intersection is counted once in `cells`. */
  function findClears(board) {
    var rows = [], cols = [], r, c;
    for (r = 0; r < BOARD_SIZE; r++) {
      var rowFull = true;
      for (c = 0; c < BOARD_SIZE; c++) { if (board[r][c] === 0) { rowFull = false; break; } }
      if (rowFull) rows.push(r);
    }
    for (c = 0; c < BOARD_SIZE; c++) {
      var colFull = true;
      for (r = 0; r < BOARD_SIZE; r++) { if (board[r][c] === 0) { colFull = false; break; } }
      if (colFull) cols.push(c);
    }
    var seen = {};
    var cells = [];
    function add(r2, c2) {
      var k = r2 * BOARD_SIZE + c2;
      if (!seen[k]) { seen[k] = true; cells.push([r2, c2]); }
    }
    rows.forEach(function (rr) { for (var cc = 0; cc < BOARD_SIZE; cc++) add(rr, cc); });
    cols.forEach(function (cc2) { for (var rr2 = 0; rr2 < BOARD_SIZE; rr2++) add(rr2, cc2); });
    return { rows: rows, cols: cols, lines: rows.length + cols.length, cells: cells };
  }

  /* Zero out cleared cells. Returns the colors that were cleared (for animation). */
  function applyClear(state, clears) {
    var cleared = [];
    clears.cells.forEach(function (cell) {
      var r = cell[0], c = cell[1];
      cleared.push({ r: r, c: c, color: state.board[r][c] });
      state.board[r][c] = 0;
    });
    return cleared;
  }

  function pushHistory(state) {
    state.history.push({
      board: cloneBoard(state.board),
      tray: cloneTray(state.tray),
      score: state.score,
      combo: state.combo
    });
    while (state.history.length > HISTORY_LIMIT) state.history.shift();
  }

  /* Score one move. Mutates state.score and state.combo. Returns points gained. */
  function scoreMove(state, pieceCells, clears) {
    var gained = pieceCells * SCORING.PLACE_PER_CELL;
    var lines = clears.lines;
    if (lines > 0) {
      gained += clears.cells.length * SCORING.CLEAR_PER_CELL * lines;
      var newCombo = state.combo + 1;
      gained += SCORING.COMBO_PER_LINE * newCombo * lines;
      state.combo = newCombo;
    } else {
      state.combo = 0;
    }
    state.score += gained;
    return gained;
  }

  /* Place a tray piece. Fills cells, scores, detects clears but does NOT zero
   * them yet: the UI animates the bloom first, then calls applyClear. */
  function placePiece(state, trayIdx, row, col) {
    var piece = state.tray[trayIdx];
    if (!piece || !canPlace(state.board, piece, row, col)) {
      return { ok: false };
    }
    pushHistory(state);
    var i;
    for (i = 0; i < piece.cells.length; i++) {
      state.board[row + piece.cells[i][0]][col + piece.cells[i][1]] = piece.color;
    }
    // Capture cleared cell colors BEFORE zeroing so the UI can animate them.
    var clears = findClears(state.board);
    var clearedPreview = clears.cells.map(function (cell) {
      return { r: cell[0], c: cell[1], color: state.board[cell[0]][cell[1]] };
    });
    var gained = scoreMove(state, piece.cells.length, clears);
    var placedCells = piece.cells.map(function (cell) {
      return [row + cell[0], col + cell[1]];
    });
    state.tray[trayIdx] = null;
    state.moves += 1;
    var trayEmpty = state.tray.every(function (p) { return p === null; });
    return {
      ok: true,
      gained: gained,
      clears: clears,
      clearedPreview: clearedPreview,
      lines: clears.lines,
      placedCells: placedCells,
      trayEmpty: trayEmpty
    };
  }

  function remainingPieces(state) {
    return state.tray.filter(function (p) { return p !== null; });
  }

  /* True if at least one piece fits anywhere on the board. */
  function anyFit(board, pieces) {
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (!piece) continue;
      var maxR = BOARD_SIZE - pieceHeight(piece);
      var maxC = BOARD_SIZE - pieceWidth(piece);
      for (var r = 0; r <= maxR; r++) {
        for (var c = 0; c <= maxC; c++) {
          if (canPlace(board, piece, r, c)) return true;
        }
      }
    }
    return false;
  }

  /* Game over iff there are remaining tray pieces and NONE of them fits
   * anywhere. A genuinely full board is the only way to die. No rigging. */
  function checkGameOver(state) {
    var pieces = remainingPieces(state);
    if (pieces.length === 0) return false; // caller deals a new tray first
    return !anyFit(state.board, pieces);
  }

  /* Deal 3 new pieces using the fair generator. */
  function dealTray(state, rng) {
    state.tray = loadGenerator().drawTray(state.board, rng);
    return state.tray;
  }

  /* Undo the last placement: restore board, tray, score and combo. */
  function undo(state) {
    var snap = state.history.pop();
    if (!snap) return false;
    state.board = snap.board;
    state.tray = snap.tray;
    state.score = snap.score;
    state.combo = snap.combo;
    return true;
  }

  /* Clear a single filled cell (hammer power-up). Not part of undo history. */
  function hammerCell(state, r, c) {
    if (!inBounds(r, c) || state.board[r][c] === 0) return false;
    state.board[r][c] = 0;
    return true;
  }

  function boardFill(board) {
    var filled = 0;
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) { if (board[r][c] !== 0) filled++; }
    }
    return filled / (BOARD_SIZE * BOARD_SIZE);
  }

  var api = {
    BOARD_SIZE: BOARD_SIZE,
    HISTORY_LIMIT: HISTORY_LIMIT,
    SCORING: SCORING,
    createGame: createGame,
    emptyBoard: emptyBoard,
    cloneBoard: cloneBoard,
    cloneTray: cloneTray,
    clonePiece: clonePiece,
    canPlace: canPlace,
    pieceHeight: pieceHeight,
    pieceWidth: pieceWidth,
    findClears: findClears,
    applyClear: applyClear,
    scoreMove: scoreMove,
    placePiece: placePiece,
    remainingPieces: remainingPieces,
    anyFit: anyFit,
    checkGameOver: checkGameOver,
    dealTray: dealTray,
    undo: undo,
    hammerCell: hammerCell,
    boardFill: boardFill
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    var root = typeof globalThis !== 'undefined' ? globalThis : this;
    root.BlockBloom = root.BlockBloom || {};
    root.BlockBloom.game = api;
  }
})();
