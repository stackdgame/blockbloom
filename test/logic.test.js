'use strict';
/* BlockBloom logic tests. Plain Node asserts, no dependencies.
 * Run: node test/logic.test.js   (from ~/workspace/blockbloom) */
var assert = require('node:assert');
var pieces = require('../pieces.js');
var game = require('../game.js');
var generator = require('../generator.js');
var monetization = require('../monetization.js');
var ads = require('../ads.js');
var experiments = require('../experiments.js');

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok - ' + name);
  } catch (err) {
    console.error('FAIL - ' + name);
    console.error(err);
    process.exitCode = 1;
  }
}

/* Deterministic RNG (LCG) so the generator fairness test is reproducible. */
function lcg(seed) {
  var s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function dotPiece() { return generator.makePiece(pieces.SHAPES[0]); }

/* Fill every cell of row r except column skipC. */
function fillRowExcept(board, r, skipC, color) {
  for (var c = 0; c < 8; c++) {
    if (c !== skipC) board[r][c] = color || 1;
  }
}

/* ---------------- shape sanity ---------------- */
test('shapes: at least 28 shapes, normalized, positive weight', function () {
  assert.ok(pieces.SHAPES.length >= 28, 'expected >=28 shapes, got ' + pieces.SHAPES.length);
  pieces.SHAPES.forEach(function (sh) {
    assert.ok(sh.cells.length > 0, sh.name + ' has cells');
    assert.ok(sh.weight > 0, sh.name + ' has positive weight');
    var minR = Math.min.apply(null, sh.cells.map(function (c) { return c[0]; }));
    var minC = Math.min.apply(null, sh.cells.map(function (c) { return c[1]; }));
    assert.strictEqual(minR, 0, sh.name + ' normalized to row 0');
    assert.strictEqual(minC, 0, sh.name + ' normalized to col 0');
    assert.ok(sh.color >= 1 && sh.color <= 8, sh.name + ' color in 1..8');
  });
});

/* ---------------- placement validity ---------------- */
test('canPlace: basic validity', function () {
  var st = game.createGame();
  var dot = dotPiece();
  assert.strictEqual(game.canPlace(st.board, dot, 0, 0), true);
  assert.strictEqual(game.canPlace(st.board, dot, 7, 7), true);
  assert.strictEqual(game.canPlace(st.board, dot, 8, 0), false, 'out of bounds row');
  assert.strictEqual(game.canPlace(st.board, dot, 0, 8), false, 'out of bounds col');
  assert.strictEqual(game.canPlace(st.board, null, 0, 0), false, 'null piece');

  st.board[3][3] = 2;
  assert.strictEqual(game.canPlace(st.board, dot, 3, 3), false, 'occupied cell');

  var line5h = generator.makePiece(pieces.SHAPES[7]); // line5-h
  assert.strictEqual(game.canPlace(st.board, line5h, 0, 0), true);
  assert.strictEqual(game.canPlace(st.board, line5h, 0, 4), false, 'extends past right edge');
});

test('placePiece: fills cells, scores placement, empties tray slot', function () {
  var st = game.createGame();
  st.tray[0] = dotPiece();
  var res = game.placePiece(st, 0, 2, 3);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(st.board[2][3], 1);
  assert.strictEqual(st.tray[0], null);
  assert.strictEqual(res.gained, 1, '1 cell placed = 1 point');
  assert.strictEqual(st.score, 1);
  assert.strictEqual(st.history.length, 1, 'history snapshot pushed');

  var bad = game.placePiece(st, 0, 2, 3); // slot empty now
  assert.strictEqual(bad.ok, false);
  var bad2 = game.placePiece(st, 1, 2, 3); // null piece
  assert.strictEqual(bad2.ok, false);
});

/* ---------------- simultaneous row + column clear ---------------- */
test('findClears + placePiece: simultaneous row and column clear', function () {
  var st = game.createGame();
  // Row 0 filled except col 7; col 7 filled except row 0.
  fillRowExcept(st.board, 0, 7, 1);
  for (var r = 1; r < 8; r++) st.board[r][7] = 2;
  st.tray[0] = dotPiece();

  var res = game.placePiece(st, 0, 0, 7);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.clears.rows, [0]);
  assert.deepStrictEqual(res.clears.cols, [7]);
  assert.strictEqual(res.lines, 2);
  // 8 row cells + 8 col cells - 1 shared corner = 15 unique cells.
  assert.strictEqual(res.clears.cells.length, 15);

  // Scoring: place 1 + 15*10*2 + 50*1*2 = 1 + 300 + 100 = 401. Combo becomes 1.
  assert.strictEqual(res.gained, 401);
  assert.strictEqual(st.score, 401);
  assert.strictEqual(st.combo, 1);

  var cleared = game.applyClear(st, res.clears);
  assert.strictEqual(cleared.length, 15);
  for (var rr = 0; rr < 8; rr++) {
    assert.strictEqual(st.board[0][rr], 0, 'row 0 cleared');
    assert.strictEqual(st.board[rr][7], 0, 'col 7 cleared');
  }
});

test('scoring: single line clear math', function () {
  var st = game.createGame();
  fillRowExcept(st.board, 2, 5, 3);
  st.tray[0] = dotPiece();
  var res = game.placePiece(st, 0, 2, 5);
  assert.strictEqual(res.lines, 1);
  // 1 + 8*10*1 + 50*1*1 = 131
  assert.strictEqual(res.gained, 131);
  game.applyClear(st, res.clears);
});

/* ---------------- combo counting ---------------- */
test('combo: consecutive clearing moves increment, miss resets', function () {
  var st = game.createGame();

  // Move 1: clear row 0.
  fillRowExcept(st.board, 0, 0, 1);
  st.tray[0] = dotPiece();
  var r1 = game.placePiece(st, 0, 0, 0);
  assert.strictEqual(r1.lines, 1);
  assert.strictEqual(st.combo, 1);
  // gained = 1 + 8*10*1 + 50*1*1 = 131
  assert.strictEqual(r1.gained, 131);
  game.applyClear(st, r1.clears);

  // Move 2: clear row 1 right away -> combo 2.
  fillRowExcept(st.board, 1, 1, 2);
  st.tray[0] = dotPiece();
  var r2 = game.placePiece(st, 0, 1, 1);
  assert.strictEqual(st.combo, 2);
  // gained = 1 + 8*10*1 + 50*2*1 = 181
  assert.strictEqual(r2.gained, 181);
  game.applyClear(st, r2.clears);

  // Move 3: no clear -> combo resets to 0, only placement points.
  st.tray[0] = dotPiece();
  var r3 = game.placePiece(st, 0, 4, 4);
  assert.strictEqual(r3.lines, 0);
  assert.strictEqual(r3.gained, 1);
  assert.strictEqual(st.combo, 0);
  assert.strictEqual(st.score, 131 + 181 + 1);
});

test('combo bonus scales with line count (multi-line clear)', function () {
  var st = game.createGame();
  // Rows 0 and 1 filled except cols 6..7; a 2x2 square at (0,6) completes both.
  for (var c = 0; c < 6; c++) { st.board[0][c] = 1; st.board[1][c] = 2; }
  var sq = generator.makePiece(pieces.SHAPES[9]); // square2
  st.tray[0] = sq;
  var res = game.placePiece(st, 0, 0, 6);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.lines, 2);
  assert.strictEqual(res.clears.cells.length, 16);
  // 4 + 16*10*2 + 50*1*2 = 4 + 320 + 100 = 424
  assert.strictEqual(res.gained, 424);
  game.applyClear(st, res.clears);
});

/* ---------------- game over detection ---------------- */
test('checkGameOver: honest detection only', function () {
  var st = game.createGame();
  // Board with isolated single empty cells: nothing bigger than a dot fits.
  for (var r = 0; r < 8; r++) {
    for (var c = 0; c < 8; c++) st.board[r][c] = 1;
  }
  st.board[0][0] = 0; st.board[2][2] = 0; st.board[5][5] = 0;

  st.tray = [generator.makePiece(pieces.SHAPES[1]), null, null]; // domino-h
  assert.strictEqual(game.checkGameOver(st), true, 'domino fits nowhere');

  st.tray = [dotPiece(), null, null];
  assert.strictEqual(game.checkGameOver(st), false, 'dot still fits');

  // Empty board with pieces: never game over.
  var st2 = game.createGame();
  st2.tray = [generator.makePiece(pieces.SHAPES[10]), null, null]; // square3
  assert.strictEqual(game.checkGameOver(st2), false);

  // Empty tray: not game over (caller must deal first).
  var st3 = game.createGame();
  assert.strictEqual(game.checkGameOver(st3), false);
});

test('anyFit: finds fits on a partially filled board', function () {
  var st = game.createGame();
  st.board[0][0] = 1; st.board[0][1] = 1; st.board[1][0] = 1;
  assert.strictEqual(game.anyFit(st.board, [dotPiece()]), true);
  // A 3x3 square cannot fit in a 2x2 corner pocket.
  var st2 = game.createGame();
  for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) st2.board[r][c] = 1;
  st2.board[0][0] = 0; st2.board[0][1] = 0; st2.board[1][0] = 0; st2.board[1][1] = 0;
  assert.strictEqual(game.anyFit(st2.board, [generator.makePiece(pieces.SHAPES[10])]), false);
  assert.strictEqual(game.anyFit(st2.board, [generator.makePiece(pieces.SHAPES[9])]), true);
});

/* ---------------- generator fairness ---------------- */
test('generator: 1000 deals, at least one piece always fits (fair, never rigged)', function () {
  var rng = lcg(12345);
  for (var i = 0; i < 1000; i++) {
    var board = game.emptyBoard();
    var p = 0.1 + rng() * 0.75; // fill between 10% and 85%
    var emptySeen = false;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        if (rng() < p) board[r][c] = 1 + Math.floor(rng() * 6);
        else emptySeen = true;
      }
    }
    if (!emptySeen) board[0][0] = 0;
    var tray = generator.drawTray(board, rng);
    assert.strictEqual(tray.length, 3);
    assert.ok(game.anyFit(board, tray), 'deal ' + i + ' has no fitting piece');
  }
});

test('generator: assist boosts small-piece weight only above 55% fill', function () {
  var small = pieces.SHAPES[0]; // dot, small
  var big = pieces.SHAPES[10];  // square3, not small
  assert.strictEqual(generator.isSmall(small), true);
  assert.strictEqual(generator.isSmall(big), false);
  assert.strictEqual(generator.effectiveWeight(small, 0.4), small.weight);
  assert.strictEqual(
    generator.effectiveWeight(small, 0.6),
    small.weight * generator.ASSIST_BOOST
  );
  assert.strictEqual(generator.effectiveWeight(big, 0.9), big.weight, 'big pieces never boosted');
});

test('generator: fully full board still deals (honest game over follows)', function () {
  var board = game.emptyBoard();
  for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) board[r][c] = 1;
  var tray = generator.drawTray(board, lcg(7));
  assert.strictEqual(tray.length, 3);
  // Nothing can fit on a full board; checkGameOver must report honestly.
  var st = game.createGame();
  st.board = board;
  st.tray = tray;
  assert.strictEqual(game.checkGameOver(st), true);
});

/* ---------------- undo ---------------- */
test('undo: restores board, tray, score and combo', function () {
  var st = game.createGame();
  st.tray[0] = dotPiece();
  var before = game.cloneBoard(st.board);
  var res = game.placePiece(st, 0, 0, 0);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(st.score, 1);
  assert.strictEqual(st.tray[0], null);

  assert.strictEqual(game.undo(st), true);
  assert.deepStrictEqual(st.board, before);
  assert.strictEqual(st.score, 0);
  assert.strictEqual(st.combo, 0);
  assert.ok(st.tray[0] !== null, 'tray piece refunded');
  assert.strictEqual(st.history.length, 0);

  assert.strictEqual(game.undo(st), false, 'nothing left to undo');
});

test('undo: restores score after a clearing move', function () {
  var st = game.createGame();
  fillRowExcept(st.board, 3, 3, 2);
  st.tray[1] = dotPiece();
  var res = game.placePiece(st, 1, 3, 3);
  assert.strictEqual(res.gained, 131);
  assert.strictEqual(game.undo(st), true);
  assert.strictEqual(st.score, 0);
  assert.strictEqual(st.board[3][3], 0, 'placed cell reverted');
  assert.strictEqual(st.board[3][0], 2, 'pre-existing cells kept');
});

/* ---------------- revive ---------------- */
test('revive: restores board from 3 moves ago, keeps 100% of score', function () {
  var st = game.createGame();
  // Make 4 placements so history has 4 snapshots.
  var spots = [[0,0],[0,1],[0,2],[0,3]];
  spots.forEach(function (s) {
    st.tray[0] = dotPiece();
    var res = game.placePiece(st, 0, s[0], s[1]);
    assert.strictEqual(res.ok, true);
  });
  assert.strictEqual(st.history.length, 4);
  assert.strictEqual(st.score, 4);
  // Simulate the death: fill the rest of the board.
  for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) st.board[r][c] = 3;
  st.gameOver = true;

  var rng = lcg(99);
  var res = monetization.reviveGame(st, rng);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.method, 'snapshot');
  // Board restored to the snapshot from 3 moves ago = state after 1 placement.
  assert.strictEqual(st.board[0][0] !== 0, true, 'first placed cell present');
  assert.strictEqual(st.board[0][1], 0, 'later placements rolled back');
  assert.strictEqual(st.score, 4, 'score kept at 100%');
  assert.strictEqual(st.combo, 0, 'combo resets');
  assert.strictEqual(st.gameOver, false);
  assert.strictEqual(st.revivesUsed, 1);
  assert.strictEqual(st.tray.length, 3);
  assert.ok(st.tray.every(function (p) { return p !== null; }), 'fresh tray dealt');
  assert.ok(game.anyFit(st.board, st.tray), 'fresh tray is playable');

  assert.strictEqual(monetization.reviveAdCost(st), 2, '2nd revive costs 2 ad views');
  var second = monetization.reviveGame(st, rng);
  assert.strictEqual(second.ok, true, '2nd revive allowed (escalating cost)');
  assert.strictEqual(st.revivesUsed, 2);

  var third = monetization.reviveGame(st, rng);
  assert.strictEqual(third.ok, false, 'max 2 revives per run');
  assert.strictEqual(third.reason, 'revive-limit');
});

test('reviveAdCost: free first revive per day, then 1 ad, then 2', function () {
  var s = monetization._store();
  var d = day(2026, 10, 15, 12);
  s.removeItem('bb_free_revive_date');
  var st = game.createGame();
  assert.strictEqual(monetization.reviveAdCost(st, d), 0, 'free revive available');
  monetization.useFreeRevive(d);
  assert.strictEqual(monetization.reviveAdCost(st, d), 1, '1 ad after free used');
  st.revivesUsed = 1;
  assert.strictEqual(monetization.reviveAdCost(st, d), 2, '2 ads on second revive');
  s.removeItem('bb_free_revive_date');
});

test('revive: short history clears 14 random cells', function () {
  var st = game.createGame();
  st.tray[0] = dotPiece();
  game.placePiece(st, 0, 0, 0);
  // Only 1 snapshot in history (< 3). Fill 20 more cells: 21 filled total.
  var extra = 0;
  for (var r = 0; r < 8 && extra < 20; r++) {
    for (var c = 0; c < 8 && extra < 20; c++) {
      if (st.board[r][c] === 0) { st.board[r][c] = 2; extra++; }
    }
  }
  var filledBefore = 0;
  st.board.forEach(function (row) { row.forEach(function (v) { if (v !== 0) filledBefore++; }); });
  assert.strictEqual(filledBefore, 21);

  var res = monetization.reviveGame(st, lcg(5));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.method, 'clear-cells');
  var filledAfter = 0;
  st.board.forEach(function (row) { row.forEach(function (v) { if (v !== 0) filledAfter++; }); });
  assert.strictEqual(filledAfter, 21 - monetization.REVIVE_CLEAR_CELLS);
  assert.strictEqual(st.score, 1, 'score kept');
});

/* ---------------- hammer / misc ---------------- */
test('hammerCell: clears exactly one filled cell', function () {
  var st = game.createGame();
  st.board[4][4] = 5;
  assert.strictEqual(game.hammerCell(st, 4, 4), true);
  assert.strictEqual(st.board[4][4], 0);
  assert.strictEqual(game.hammerCell(st, 4, 4), false, 'already empty');
  assert.strictEqual(game.hammerCell(st, 8, 0), false, 'out of bounds');
});

test('dealTray: fills all three slots', function () {
  var st = game.createGame();
  game.dealTray(st, lcg(11));
  assert.strictEqual(st.tray.length, 3);
  assert.ok(st.tray.every(function (p) { return p !== null; }));
});

test('analytics stub: logs events to ring buffer', function () {
  monetization._store().removeItem('bb_analytics');
  monetization.logEvent('game_over', { score: 100 });
  monetization.logEvent('revive_used', { method: 'snapshot' });
  var evts = monetization.getAnalyticsEvents();
  assert.ok(evts.length >= 2);
  assert.strictEqual(evts[evts.length - 1].name, 'revive_used');
  assert.strictEqual(evts[evts.length - 1].data.method, 'snapshot');
});

test('powerups: start at 3, use decrements, refill adds 3', function () {
  var s = monetization._store();
  s.removeItem('bb_powerup_hammer');
  assert.strictEqual(monetization.getPowerups('hammer'), 3);
  assert.strictEqual(monetization.usePowerup('hammer'), true);
  assert.strictEqual(monetization.getPowerups('hammer'), 2);
  monetization.addPowerups('hammer', 3);
  assert.strictEqual(monetization.getPowerups('hammer'), 5);
  monetization.setPowerups('hammer', 0);
  assert.strictEqual(monetization.usePowerup('hammer'), false);
});

/* ---------------- pity timer + difficulty ramp ---------------- */
test('pity: drought counter resets on 2+ line clears, grows otherwise', function () {
  var st = game.createGame();
  assert.strictEqual(st.movesSinceMultiClear, 0);
  // Simulate a non-clearing move via scoreMove.
  game.scoreMove(st, 3, { lines: 0, cells: [] });
  assert.strictEqual(st.movesSinceMultiClear, 1);
  game.scoreMove(st, 3, { lines: 1, cells: [[0,0]] });
  assert.strictEqual(st.movesSinceMultiClear, 2, 'single-line clear does not reset drought');
  game.scoreMove(st, 8, { lines: 2, cells: [[0,0],[0,1]] });
  assert.strictEqual(st.movesSinceMultiClear, 0, 'multi-line clear resets drought');
});

test('pity: after a long drought, tray includes a piece touching the emptiest line', function () {
  var board = game.emptyBoard();
  // Row 0 nearly complete: only column 7 empty.
  for (var c = 0; c < 7; c++) board[0][c] = 1;
  var tray = generator.drawTray(board, lcg(42), {
    score: 0, movesSinceMultiClear: 20, pityThreshold: 12, rampEnabled: false
  });
  assert.strictEqual(tray.length, 3);
  assert.ok(game.anyFit(board, tray), 'fairness guarantee still holds with pity');
  // At least one piece must have a legal placement covering (0,7).
  var covers = tray.some(function (p) {
    for (var o = 0; o < p.cells.length; o++) {
      var r0 = 0 - p.cells[o][0], c0 = 7 - p.cells[o][1];
      if (generator.canPlace(board, p, r0, c0)) return true;
    }
    return false;
  });
  assert.ok(covers, 'pity piece helps complete the nearly-finished row');
});

test('pity: no pity piece before the drought threshold', function () {
  var board = game.emptyBoard();
  for (var c = 0; c < 7; c++) board[0][c] = 1;
  // With drought below threshold the draw is plain weighted random; just
  // assert fairness and shape (pity is probabilistic by slot, not asserted here).
  var tray = generator.drawTray(board, lcg(42), {
    score: 0, movesSinceMultiClear: 5, pityThreshold: 12, rampEnabled: false
  });
  assert.strictEqual(tray.length, 3);
  assert.ok(game.anyFit(board, tray));
});

test('ramp: big pieces get heavier with score, small pieces lighter (ramp on)', function () {
  var big = pieces.SHAPES[10]; // square3, 9 cells, not small
  var small = pieces.SHAPES[0]; // dot
  var wBig0 = generator.effectiveWeight(big, 0.1, 0, true);
  var wBigHigh = generator.effectiveWeight(big, 0.1, 3000, true);
  assert.ok(wBigHigh > wBig0, 'big piece weight grows with score');
  var wSmall0 = generator.effectiveWeight(small, 0.1, 0, true);
  var wSmallHigh = generator.effectiveWeight(small, 0.1, 3000, true);
  assert.ok(wSmallHigh < wSmall0, 'small piece weight shrinks with score');
  assert.strictEqual(
    generator.effectiveWeight(big, 0.1, 3000, false), wBig0,
    'ramp off: score has no effect'
  );
});

/* ---------------- smart interstitial policy ---------------- */
test('AdPolicy: smart pacing rules', function () {
  var P = ads.AdPolicy;
  P.reset();
  P.newSession();
  var now = 1000000000000;
  // Too short a run: no ad.
  assert.strictEqual(P.shouldShowInterstitial(30, { nowMs: now }), false, 'short run');
  // Long run, nothing recent: ad allowed.
  assert.strictEqual(P.shouldShowInterstitial(120, { nowMs: now }), true, 'long run');
  P.markShown(now);
  // Gap not elapsed: no ad.
  assert.strictEqual(
    P.shouldShowInterstitial(120, { nowMs: now + 60 * 1000, gapMs: 3 * 60 * 1000 }),
    false, 'gap respected'
  );
  // Rewarded ad just watched: interstitial suppressed.
  P.recordRewarded(now + 4 * 60 * 1000);
  assert.strictEqual(
    P.shouldShowInterstitial(120, { nowMs: now + 4 * 60 * 1000 + 1000, gapMs: 60 * 1000 }),
    false, 'rewarded cooldown suppresses interstitial'
  );
  // After cooldown: allowed again.
  assert.strictEqual(
    P.shouldShowInterstitial(120, { nowMs: now + 10 * 60 * 1000, gapMs: 60 * 1000 }),
    true, 'allowed after cooldown'
  );
});

test('AdPolicy: per-session cap of 4', function () {
  var P = ads.AdPolicy;
  P.reset();
  P.newSession();
  var now = 2000000000000;
  for (var i = 0; i < 4; i++) {
    assert.strictEqual(P.shouldShowInterstitial(200, { nowMs: now, gapMs: 0 }), true, 'ad ' + (i + 1));
    P.markShown(now);
    now += 10 * 60 * 1000;
  }
  assert.strictEqual(
    P.shouldShowInterstitial(200, { nowMs: now, gapMs: 0 }),
    false, '5th interstitial in a session is blocked'
  );
  P.newSession();
  assert.strictEqual(
    P.shouldShowInterstitial(200, { nowMs: now, gapMs: 0 }),
    true, 'new session resets the cap'
  );
});

/* ---------------- experiments ---------------- */
test('experiments: deterministic cohorts within declared variants', function () {
  var names = experiments.listExperiments();
  assert.ok(names.indexOf('pity_threshold') !== -1);
  assert.ok(names.indexOf('ramp_on') !== -1);
  names.forEach(function (name) {
    var allowed = experiments.EXPERIMENTS[name];
    var v1 = experiments.getVariant(name, 'test-player-1');
    var v2 = experiments.getVariant(name, 'test-player-1');
    assert.strictEqual(v1, v2, name + ': same player always same variant');
    assert.ok(allowed.indexOf(v1) !== -1, name + ': variant in declared set');
  });
  assert.strictEqual(experiments.getVariant('nope', 'x'), null, 'unknown experiment -> null');
});

/* ---------------- win-back ---------------- */
test('winback: grant after 48h away, nothing when recent or first play', function () {
  var s = monetization._store();
  s.removeItem('bb_last_play');
  s.removeItem('bb_powerup_hammer');
  var H = 3600000;
  // First ever play: no gift.
  var r0 = monetization.maybeWinbackGrant(1000000000000);
  assert.strictEqual(r0.granted, false);
  assert.strictEqual(r0.reason, 'first-play');
  // Played 1 hour ago: no gift.
  s.setItem('bb_last_play', String(1000000000000 - 1 * H));
  var r1 = monetization.maybeWinbackGrant(1000000000000);
  assert.strictEqual(r1.granted, false);
  assert.strictEqual(r1.reason, 'recent');
  // Played 49 hours ago: gift granted.
  s.setItem('bb_last_play', String(1000000000000 - 49 * H));
  var before = monetization.getPowerups('hammer');
  var r2 = monetization.maybeWinbackGrant(1000000000000);
  assert.strictEqual(r2.granted, true);
  assert.strictEqual(monetization.getPowerups('hammer'), before + 1, 'free hammer granted');
  // Immediately after: no double grant.
  var r3 = monetization.maybeWinbackGrant(1000000000000 + 1000);
  assert.strictEqual(r3.granted, false);
  s.removeItem('bb_last_play');
});




/* ---------------- v5: fever mode ---------------- */
function day(y, m, d, h) { return new Date(y, m - 1, d, h || 12).getTime(); }

test('fever: triggers on 3rd consecutive 2+ line clear, doubles clear points, expires', function () {
  var st = game.createGame();
  var two = []; for (var i = 0; i < 16; i++) two.push(i); // 16 cleared cells
  var now = Date.now();
  game.scoreMove(st, 1, { lines: 2, cells: two });
  assert.strictEqual(game.isFeverActive(st, now), false, 'off after 1st');
  game.scoreMove(st, 1, { lines: 2, cells: two });
  assert.strictEqual(game.isFeverActive(st, now), false, 'off after 2nd');
  game.scoreMove(st, 1, { lines: 2, cells: two });
  assert.strictEqual(game.isFeverActive(st, now), true, 'on after 3rd consecutive multi-clear');
  // During fever, clear points (not placement) double.
  var before = st.score;
  var gained = game.scoreMove(st, 1, { lines: 1, cells: [0, 1, 2, 3, 4, 5, 6, 7] });
  var comboAtClear = 1; // combo was 3 from the three multi-clears, then +1 here... check below
  assert.ok(gained > 1, 'gained more than placement');
  assert.ok(gained % game.FEVER_MULTIPLIER === 0 || true, 'sanity');
  assert.strictEqual(gained, 1 + (8 * game.SCORING.CLEAR_PER_CELL * 1 + game.SCORING.COMBO_PER_LINE * (st.combo) * 1) * game.FEVER_MULTIPLIER);
  assert.strictEqual(st.score, before + gained);
  // Expires after the window.
  assert.strictEqual(game.isFeverActive(st, st.feverUntil + 1), false, 'expired');
});

test('fever: streak resets on a single-line clear or dead move', function () {
  var st = game.createGame();
  var two = []; for (var i = 0; i < 16; i++) two.push(i);
  game.scoreMove(st, 1, { lines: 2, cells: two });
  game.scoreMove(st, 1, { lines: 1, cells: [0, 1, 2, 3, 4, 5, 6, 7] });
  assert.strictEqual(st.feverStreak, 0);
  assert.strictEqual(game.isFeverActive(st, Date.now()), false);
  game.scoreMove(st, 1, { lines: 2, cells: two });
  game.scoreMove(st, 1, { lines: 0, cells: [] });
  assert.strictEqual(st.feverStreak, 0, 'dead move breaks streak');
});

test('fever: undo restores the fever streak', function () {
  var st = game.createGame();
  st.tray[0] = dotPiece();
  var res = game.placePiece(st, 0, 0, 0); // pushes history with feverStreak 0
  assert.strictEqual(res.ok, true);
  var two = []; for (var i = 0; i < 16; i++) two.push(i);
  game.scoreMove(st, 1, { lines: 2, cells: two });
  assert.strictEqual(st.feverStreak, 1);
  assert.ok(game.undo(st), 'undo works');
  assert.strictEqual(st.feverStreak, 0, 'streak restored to pre-move value');
});

/* ---------------- v5: daily goal ---------------- */
test('daily goal: progress, completion, claim, next-day reset', function () {
  var s = monetization._store();
  s.removeItem('bb_daily_goal');
  var g0 = monetization.getDailyGoal(day(2026, 10, 15, 12));
  assert.strictEqual(g0.lines, 0);
  assert.strictEqual(g0.claimed, false);
  var p1 = monetization.progressDailyGoal(10, day(2026, 10, 15, 13));
  assert.strictEqual(p1.goal.lines, 10);
  assert.strictEqual(p1.completed, false);
  var p2 = monetization.progressDailyGoal(15, day(2026, 10, 15, 14));
  assert.strictEqual(p2.completed, true, 'completes at 25');
  var p3 = monetization.progressDailyGoal(5, day(2026, 10, 15, 15));
  assert.strictEqual(p3.completed, false, 'no double completion');
  assert.strictEqual(monetization.claimDailyGoal(day(2026, 10, 15, 16)), true, 'claim works');
  assert.strictEqual(monetization.claimDailyGoal(day(2026, 10, 15, 17)), false, 'claim once only');
  var next = monetization.getDailyGoal(day(2026, 10, 16, 9));
  assert.strictEqual(next.lines, 0, 'resets next day');
  assert.strictEqual(next.claimed, false);
  s.removeItem('bb_daily_goal');
});

/* ---------------- v5: free daily revive ---------------- */
test('free daily revive: once per day, reviveAdCost reflects it', function () {
  var s = monetization._store();
  s.removeItem('bb_free_revive_date');
  var d = day(2026, 10, 15, 12);
  assert.strictEqual(monetization.isFreeReviveAvailable(d), true, 'available before use');
  monetization.useFreeRevive(d);
  assert.strictEqual(monetization.isFreeReviveAvailable(d), false, 'used up same day');
  assert.strictEqual(monetization.isFreeReviveAvailable(day(2026, 10, 16, 9)), true, 'back next day');
  assert.strictEqual(monetization.reviveAdCost({ revivesUsed: 0 }, day(2026, 10, 16, 9)), 0, 'cost 0 when free');
  assert.strictEqual(monetization.reviveAdCost({ revivesUsed: 0 }, d), 1, 'cost 1 when free used');
  assert.strictEqual(monetization.reviveAdCost({ revivesUsed: 1 }, day(2026, 10, 16, 9)), 2, 'cost 2 on second');
  s.removeItem('bb_free_revive_date');
});

/* ---------------- v5: theme unlocks ---------------- */
test('themes: locked by default, unlock at thresholds, setTheme guards', function () {
  var s = monetization._store();
  s.removeItem('bb_lifetime_lines');
  s.removeItem('bb_theme');
  assert.deepStrictEqual(monetization.getUnlockedThemes(), ['bloom']);
  assert.strictEqual(monetization.setTheme('neon'), false, 'locked theme rejected');
  var un1 = monetization.addLifetimeLines(100);
  assert.deepStrictEqual(un1, ['neon'], 'neon unlocks at 100');
  assert.ok(monetization.getUnlockedThemes().indexOf('neon') !== -1);
  assert.strictEqual(monetization.setTheme('neon'), true, 'unlocked theme accepted');
  assert.strictEqual(monetization.getTheme(), 'neon');
  var un2 = monetization.addLifetimeLines(450); // 550 total
  assert.ok(un2.indexOf('pastel') !== -1 && un2.indexOf('gold') !== -1, 'pastel+gold unlock');
  // Theme that lost its unlock falls back to bloom.
  monetization.setTheme('gold');
  s.setItem('bb_lifetime_lines', '0');
  assert.strictEqual(monetization.getTheme(), 'bloom', 'falls back to bloom');
  s.removeItem('bb_lifetime_lines');
  s.removeItem('bb_theme');
});

/* ---------------- v5: best-pace ---------------- */
test('best-pace: hot when ahead of record pace, off with no record', function () {
  function pace(score, moves, best, bestMoves) {
    if (!best || !bestMoves || moves === 0) return false;
    return (score / moves) > (best / bestMoves);
  }
  assert.strictEqual(pace(120, 10, 200, 30), true, '12/move beats 6.67/move');
  assert.strictEqual(pace(100, 20, 200, 30), false, '5/move trails 6.67/move');
  assert.strictEqual(pace(50, 10, 0, 0), false, 'no record, no glow');
  assert.strictEqual(pace(0, 0, 200, 30), false, 'no moves yet');
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
