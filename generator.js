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
  var RAMP_SCORE_CAP = 3000; // score at which the difficulty ramp is fully on
  var RAMP_BIG_BOOST = 1.5;  // big-piece weight multiplier at full ramp
  var PITY_MAX_LINE_GAP = 4; // pity only helps lines missing <= 4 cells

  function shapes() { return loadPieces().SHAPES; }

  function isSmall(shape) { return !!shape.small; }

  /* Transparent difficulty ramp: as the run's score climbs, big awkward
   * pieces get heavier and small safe pieces get lighter, so long runs get
   * tenser and end naturally. Documented, same for every player. */
  function rampMultiplier(shape, score, rampEnabled) {
    if (rampEnabled === false || !(score > 0)) return 1;
    var k = Math.min(1, score / RAMP_SCORE_CAP);
    var big = shape.cells.length >= 4 && !shape.small;
    if (big) return 1 + k * RAMP_BIG_BOOST;
    if (shape.small) return Math.max(0.6, 1 - k * 0.3);
    return 1;
  }

  function effectiveWeight(shape, fill, score, rampEnabled) {
    var w = shape.weight;
    if (fill > ASSIST_FILL && isSmall(shape)) w *= ASSIST_BOOST;
    w *= rampMultiplier(shape, score, rampEnabled);
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

  function drawPiece(fill, rng, ctx) {
    ctx = ctx || {};
    var list = shapes();
    var total = 0, i;
    for (i = 0; i < list.length; i++) {
      total += effectiveWeight(list[i], fill, ctx.score, ctx.rampEnabled);
    }
    var x = rng() * total;
    for (i = 0; i < list.length; i++) {
      x -= effectiveWeight(list[i], fill, ctx.score, ctx.rampEnabled);
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

  /* Pity timer ("big-moment pacing"): after a drought of moves with no
   * exciting 2+ line clear, force one tray slot to a piece that touches the
   * emptiest line's gaps, manufacturing a satisfying moment. This only ever
   * helps the player complete lines; it never harms them. */
  function emptiestLine(board) {
    var best = null, r, c;
    function consider(type, idx, emptyCells) {
      if (emptyCells.length === 0) return; // already full, not a target
      if (!best || emptyCells.length < best.emptyCount) {
        best = { type: type, idx: idx, emptyCells: emptyCells, emptyCount: emptyCells.length };
      }
    }
    for (r = 0; r < BOARD_SIZE; r++) {
      var re = [];
      for (c = 0; c < BOARD_SIZE; c++) if (board[r][c] === 0) re.push([r, c]);
      consider('row', r, re);
    }
    for (c = 0; c < BOARD_SIZE; c++) {
      var ce = [];
      for (r = 0; r < BOARD_SIZE; r++) if (board[r][c] === 0) ce.push([r, c]);
      consider('col', c, ce);
    }
    return best;
  }

  /* Find a small piece with a legal placement covering at least one empty
   * cell of the emptiest line. Returns a made piece or null. */
  function pityPiece(board, rng) {
    var line = emptiestLine(board);
    if (!line || line.emptyCount > PITY_MAX_LINE_GAP) return null;
    var cands = shapes().filter(isSmall);
    // Shuffle candidates with the provided rng for variety.
    for (var i = cands.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
    }
    for (var s = 0; s < cands.length; s++) {
      var shape = cands[s];
      for (var e = 0; e < line.emptyCells.length; e++) {
        var er = line.emptyCells[e][0], ec = line.emptyCells[e][1];
        for (var o = 0; o < shape.cells.length; o++) {
          var r0 = er - shape.cells[o][0];
          var c0 = ec - shape.cells[o][1];
          var piece = makePiece(shape);
          if (canPlace(board, piece, r0, c0)) return piece;
        }
      }
    }
    return null;
  }

  /* Draw 3 pieces with the fairness guarantee. rng defaults to Math.random.
   * ctx (optional): { score, movesSinceMultiClear, pityThreshold, rampEnabled }.
   * Pity: when the drought reaches pityThreshold, one slot is replaced with
   * a line-helping piece (the replaced slot still keeps >=1 fitting piece,
   * so the fairness guarantee holds). */
  function drawTray(board, rng, ctx) {
    rng = rng || Math.random;
    ctx = ctx || {};
    var fill = boardFill(board);
    var drawCtx = { score: ctx.score || 0, rampEnabled: ctx.rampEnabled !== false };
    var tray = null;
    for (var t = 0; t < MAX_REDRAWS; t++) {
      tray = [drawPiece(fill, rng, drawCtx), drawPiece(fill, rng, drawCtx), drawPiece(fill, rng, drawCtx)];
      if (anyFit(board, tray)) break;
      tray = null;
    }
    if (!tray) {
      // Fallback: force one slot to a 1x1. A 1x1 fits whenever any cell is
      // empty, so the only way this still fails is a truly full board.
      tray = [drawPiece(fill, rng, drawCtx), drawPiece(fill, rng, drawCtx), makePiece(shapes()[0])];
    }
    var drought = ctx.movesSinceMultiClear || 0;
    var pityThreshold = ctx.pityThreshold || 12;
    if (drought >= pityThreshold) {
      var pp = pityPiece(board, rng);
      if (pp) tray[Math.floor(rng() * 3)] = pp;
    }
    return tray;
  }

  var api = {
    ASSIST_FILL: ASSIST_FILL,
    ASSIST_BOOST: ASSIST_BOOST,
    MAX_REDRAWS: MAX_REDRAWS,
    RAMP_SCORE_CAP: RAMP_SCORE_CAP,
    PITY_MAX_LINE_GAP: PITY_MAX_LINE_GAP,
    isSmall: isSmall,
    effectiveWeight: effectiveWeight,
    rampMultiplier: rampMultiplier,
    boardFill: boardFill,
    makePiece: makePiece,
    drawPiece: drawPiece,
    canPlace: canPlace,
    anyFit: anyFit,
    emptiestLine: emptiestLine,
    pityPiece: pityPiece,
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
