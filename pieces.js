'use strict';
/* BlockBloom piece definitions.
 * Each shape: { name, cells: [[r,c],...] normalized to top-left origin,
 * weight: spawn weight (small pieces more common), color: 1..6,
 * small: true when the piece is a "small" piece (assist bias + doc purposes). }
 * Original shape set; mechanics follow the Block Blast style described in SPEC.
 */
(function () {
  function shape(name, cells, weight, color, small) {
    return { name: name, cells: cells, weight: weight, color: color, small: !!small };
  }

  var SHAPES = [
    // singles and dominoes (small)
    shape('dot',       [[0,0]], 10, 1, true),
    shape('domino-h',  [[0,0],[0,1]], 9, 2, true),
    shape('domino-v',  [[0,0],[1,0]], 9, 3, true),
    // straight lines
    shape('line3-h', [[0,0],[0,1],[0,2]], 7, 4, true),
    shape('line3-v', [[0,0],[1,0],[2,0]], 7, 5, true),
    shape('line4-h', [[0,0],[0,1],[0,2],[0,3]], 5, 6),
    shape('line4-v', [[0,0],[1,0],[2,0],[3,0]], 5, 1),
    shape('line5-h', [[0,0],[0,1],[0,2],[0,3],[0,4]], 4, 2),
    shape('line5-v', [[0,0],[1,0],[2,0],[3,0],[4,0]], 4, 3),
    // squares and rectangles
    shape('square2', [[0,0],[0,1],[1,0],[1,1]], 7, 4),
    shape('square3', [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]], 3, 5),
    shape('rect2x3', [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]], 4, 6),
    shape('rect3x2', [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]], 4, 1),
    // small L (3 cells, all rotations)
    shape('smallL-0', [[0,0],[1,0],[1,1]], 6, 2, true),
    shape('smallL-1', [[0,0],[0,1],[1,0]], 6, 3, true),
    shape('smallL-2', [[0,0],[0,1],[1,1]], 6, 4, true),
    shape('smallL-3', [[0,1],[1,0],[1,1]], 6, 5, true),
    // L tetromino (all rotations)
    shape('L-0', [[0,0],[1,0],[2,0],[2,1]], 4, 6),
    shape('L-1', [[0,0],[0,1],[0,2],[1,0]], 4, 1),
    shape('L-2', [[0,0],[0,1],[1,1],[2,1]], 4, 2),
    shape('L-3', [[0,2],[1,0],[1,1],[1,2]], 4, 3),
    // big corner, 3x3 L of 5 cells (all rotations)
    shape('corner-0', [[0,0],[1,0],[2,0],[2,1],[2,2]], 3, 4),
    shape('corner-1', [[0,0],[0,1],[0,2],[1,0],[2,0]], 3, 5),
    shape('corner-2', [[0,0],[0,1],[0,2],[1,2],[2,2]], 3, 6),
    shape('corner-3', [[0,2],[1,2],[2,0],[2,1],[2,2]], 3, 1),
    // T tetromino (all rotations)
    shape('T-0', [[0,1],[1,0],[1,1],[1,2]], 4, 2),
    shape('T-1', [[0,0],[1,0],[1,1],[2,0]], 4, 3),
    shape('T-2', [[0,0],[0,1],[0,2],[1,1]], 4, 4),
    shape('T-3', [[0,1],[1,0],[1,1],[2,1]], 4, 5),
    // T pentomino (3 wide plus stem of 2)
    shape('Tpento', [[0,0],[0,1],[0,2],[1,1],[2,1]], 3, 6),
    // S tetromino
    shape('S-0', [[0,1],[0,2],[1,0],[1,1]], 4, 1),
    shape('S-1', [[0,0],[1,0],[1,1],[2,1]], 4, 2),
    // Z tetromino
    shape('Z-0', [[0,0],[0,1],[1,1],[1,2]], 4, 3),
    shape('Z-1', [[0,1],[1,0],[1,1],[2,0]], 4, 4),
    // plus pentomino
    shape('plus', [[0,1],[1,0],[1,1],[1,2],[2,1]], 3, 5)
  ];

  var api = { SHAPES: SHAPES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    var root = typeof globalThis !== 'undefined' ? globalThis : this;
    root.BlockBloom = root.BlockBloom || {};
    root.BlockBloom.pieces = api;
  }
})();
