'use strict';
/* BlockBloom fair piece generator. Self-contained (no dependency on game.js)
 * so it can be loaded in any order and tested standalone.
 *
 * Fairness guarantee (SPEC 2.6): weighted random draw of 3 pieces, then verify
 * at least one of the 3 fits somewhere on the current board; redraw up to 25
 * times, else force one slot to a 1x1 (which fits whenever any cell is empty).
 * Deaths are therefore always honest: the board is genuinely unplayable.
 *
 * Documented assist: when board fill exceeds ASSIST_FILL (55%), small pieces
 * get an ASSIST_BOOST (1.5x) weight multiplier. This only ever helps the
 * struggling player; it never harms them and never triggers a death.
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

  var BOARD_SIZE = 8;
  var ASSIST_FILL = 0.55;
  var ASSIST_BOOST = 1.5;
  var MAX_REDRAWS = 25;

  function shapes() { return loadPieces().SHAPES; }

  function isSmall(shape) { return !!shape.small; }

  function effectiveWeight(shape, fill) {
    var w = shape.weight;
    if (fill > ASSIST_FILL && isSmall(shape)) w *= ASSIST_BOOST;
    return w;
  }

  function boardFill(board) {
    var filled = 0;
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) { if (board[r][c] !== 0) filled++; }
    }
    return filled / (BOARD_SIZE * BOARD_SIZE);
  }

  function pieceDims(cells) {
    var h = 0, w = 0, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] + 1 > h) h = cells[i][0] + 1;
      if (cells[i][1] + 1 > w) w = cells[i][1] + 1;
    }
    return { h: h, w: w };
  }

  function makePiece(shape) {
    var dims = pieceDims(shape.cells);
    return {
      name: shape.name,
      cells: shape.cells.map(function (c) { return [c[0], c[1]]; }),
      weight: shape.weight,
      color: shape.color,
      small: shape.small,
      w: dims.w,
      h: dims.h
    };
  }

  function drawPiece(fill, rng) {
    var list = shapes();
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += effectiveWeight(list[i], fill);
    var x = rng() * total;
    for (i = 0; i < list.length; i++) {
      x -= effectiveWeight(list[i], fill);
      if (x <= 0) return makePiece(list[i]);
    }
    return makePiece(list[list.length - 1]);
  }

  function canPlace(board, piece, row, col) {
    for (var i = 0; i < piece.cells.length; i++) {
      var r = row + piece.cells[i][0];
      var c = col + piece.cells[i][1];
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
      if (board[r][c] !== 0) return false;
    }
    return true;
  }

  /* True if at least one piece fits anywhere on the board. */
  function anyFit(board, pieces) {
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (!piece) continue;
      var dims = pieceDims(piece.cells);
      for (var r = 0; r <= BOARD_SIZE - dims.h; r++) {
        for (var c = 0; c <= BOARD_SIZE - dims.w; c++) {
          if (canPlace(board, piece, r, c)) return true;
        }
      }
    }
    return false;
  }

  /* Draw 3 pieces with the fairness guarantee. rng defaults to Math.random. */
  function drawTray(board, rng) {
    rng = rng || Math.random;
    var fill = boardFill(board);
    var tray = null;
    for (var t = 0; t < MAX_REDRAWS; t++) {
      tray = [drawPiece(fill, rng), drawPiece(fill, rng), drawPiece(fill, rng)];
      if (anyFit(board, tray)) return tray;
    }
    // Fallback: force one slot to a 1x1. A 1x1 fits whenever any cell is
    // empty, so the only way this still fails is a truly full board.
    tray = [drawPiece(fill, rng), drawPiece(fill, rng), makePiece(shapes()[0])];
    return tray;
  }

  var api = {
    ASSIST_FILL: ASSIST_FILL,
    ASSIST_BOOST: ASSIST_BOOST,
    MAX_REDRAWS: MAX_REDRAWS,
    isSmall: isSmall,
    effectiveWeight: effectiveWeight,
    boardFill: boardFill,
    makePiece: makePiece,
    drawPiece: drawPiece,
    canPlace: canPlace,
    anyFit: anyFit,
    drawTray: drawTray
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    var root = typeof globalThis !== 'undefined' ? globalThis : this;
    root.BlockBloom = root.BlockBloom || {};
    root.BlockBloom.generator = api;
  }
})();
