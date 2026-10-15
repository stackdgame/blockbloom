# BlockBloom — Build Spec

A Block Blast-style 8x8 block puzzle game with ORIGINAL UI/art/name, implementing
the gameplay logic and monetization architecture described in the reference video.
Deliberate deviations from the video's "exact logic" are marked [DEVIATION] with reasons.

## 1. Identity

- Name: **BlockBloom**
- Tagline: "Plant blocks. Bloom combos."
- Theme: light, airy garden. Warm cream background (#FAF6EE), soft sage board,
  jewel/petal-toned blocks with rounded corners and subtle gradients.
- Must NOT look like Block Blast (dark blue). Light theme, rounded chunky shapes,
  friendly rounded type (system font stack).
- Branding: "BlockBloom by stackdgame". No mention of any other brand.

## 2. Core gameplay (Block Blast mechanics, original code)

### 2.1 Board
- 8x8 grid. Each cell empty or filled with a color id.
- Cell size responsive; board max ~420px wide, centered.

### 2.2 Pieces
- Tray of 3 pieces below the board.
- Piece = set of [r,c] cells + color id. Full shape list (~28 shapes):
  - 1x1; dominoes 1x2, 2x1; lines 1x3, 3x1, 1x4, 4x1, 1x5, 5x1
  - squares 2x2, 3x3; rects 2x3, 3x2
  - small L (2x2 minus one cell, all 4 rotations)
  - L tetromino (3 long + foot, 4 rotations)
  - big corner (3x3 L = 5 cells, 4 rotations)
  - T tetromino (4 rotations), T pentomino (3-wide + stem of 2)
  - S/Z tetrominoes (2 rotations each)
  - plus (+) pentomino
- Each shape has a spawn weight (small pieces more common).

### 2.3 Drag & drop
- Pointer Events (mouse + touch). Drag piece from tray; a ghost preview follows.
- On the board, show a translucent placement preview snapped to the grid cell
  under the pointer; green tint if the placement is legal, red tint if not.
- On release over a legal cell: piece locks in, cells fill, tray slot empties.
- On release over illegal/no cell: piece animates back to tray.
- While dragging, tray piece scales up slightly; board highlights target cells.

### 2.4 Placement & clears
- Placing a piece: score += number of cells in the piece.
- After placement, find all full rows and all full columns; clear them
  simultaneously with a bloom animation (scale/pop + particles).
- Cleared cells: score += clearedCells * 10 * numLinesClearedThisMove.
  (So a 2-line clear pays 2x per cell, 3-line 3x, etc.)
- Combo: if clears happen on consecutive moves, combo++ (else combo resets to 0).
  comboBonus = 50 * combo * numLinesClearedThisMove, added to score.
  Show "Combo x2", "Combo x3" popup. Combo resets when a move clears nothing.
- After all 3 tray pieces are placed, deal 3 new pieces.

### 2.5 Game over
- After every placement (and after every new deal), check: does at least one
  remaining tray piece fit anywhere on the board? If NO piece fits anywhere:
  game over. Show "No Space Left" panel: final score, best score (localStorage),
  buttons: [Bloom Again] restart, [Watch ad to keep going] revive (rewarded ad).
- History: keep last 8 board states (for undo + revive).

### 2.6 Fair piece generation [DEVIATION from video]
- The video describes rigging piece draws to kill the player when a high-value
  ad is ready ("death algorithm"). We do NOT do that.
- Generator: weighted random draw of 3 pieces. Then verify at least one of the
  3 fits somewhere on the current board; if not, redraw (max 25 tries), else
  force one slot to a 1x1. This guarantees deaths are honest (board genuinely
  full), which is also what keeps players trusting the game.
- Documented assist (player-friendly, disclosed in DESIGN.md): when board fill
  > 55%, small-piece weights get a 1.5x boost. Helps struggling players, never
  harms them.

### 2.7 Scoring summary (single source of truth in code: SCORING)
- placeScore = cells placed * 1
- clearScore = clearedCells * 10 * linesCleared
- comboBonus = 50 * combo * linesCleared (combo counts consecutive clearing moves)
- No score is ever taken away. Revive keeps 100% of score [DEVIATION: the video's
  version restores only ~10% after a full ad view; we restore everything].

## 3. Power-ups
- Hammer: tap hammer, tap any filled cell → cell clears (with animation). Start: 3.
- Undo: revert to board state before last placement (also refunds the tray piece).
  Start: 3.
- Running out → "Get +3" button → rewarded ad → +3 of that power-up.
- Power-up counts persist in localStorage.

## 4. Monetization architecture (honest version of the video's strategy)

### 4.1 What we implement
1. **Rewarded revive (player's choice):** on game over, "Watch ad to keep going".
   Ad completes → revive: restore board to state 3 moves ago (or clear 14 random
   cells if history is short), keep 100% of score, combo resets. Max 1 revive/run.
2. **Rewarded power-up refills:** "Get +3 hammers" via rewarded ad.
3. **Interstitials:** after game over, only if run lasted > 60s AND at most 1 per
   4 minutes AND at most 1 per 3 game-overs. Never interrupts active play.
   Skippable after 5s.
4. **Remove-ads hook:** `monetization.hasRemoveAds()` flag (default false) that
   disables interstitials; purchase wiring left for the native-wrapper phase.
5. **Analytics stub:** every monetization event (ad_shown, ad_completed,
   revive_used, powerup_earned, game_over, run_start) logged to localStorage
   ring buffer + console, ready to forward to a real analytics endpoint.

### 4.2 AdsProvider interface (js/ads.js)
```js
// Implement this interface to plug a real ad network:
{
  isRewardedReady(slot): boolean,
  showRewarded(slot): Promise<'completed'|'skipped'|'failed'>,
  isInterstitialReady(): boolean,
  showInterstitial(): Promise<'closed'|'failed'>
}
```
- Ship `DemoAdsProvider`: renders a clearly-labeled "DEMO AD" card with a
  5s countdown then a close/continue button. Fullscreen overlay, game pauses.
- Document in DESIGN.md exactly what Milan needs for real money:
  option A (web): a web rewarded-video network account + paste SDK key;
  option B (app stores): Capacitor wrapper + AdMob account (stackdgame@gmail.com).
  Do NOT invent a working network.

### 4.3 What we deliberately do NOT implement [DEVIATION]
- No device-data "worth" model (no phone model / country / settings harvesting
  fed into a revenue predictor).
- No hidden death-triggering. Game-over happens if and only if the board is
  genuinely unplayable. Difficulty assist only ever helps the player.

## 5. UI/UX requirements
- Mobile-first, works with touch and mouse. Prevent page scroll while dragging
  (touch-action: none on game area).
- Top bar: 🌸 logo + "BlockBloom", score (animated count-up), best score,
  power-up buttons (🔨 xN, ↩️ xN), mute button, restart button.
- Board: rounded container, subtle grid, cells pop in with scale animation.
- Tray: 3 slots; pieces rendered at smaller scale, centered.
- Feedback: clear animations (bloom scale + particle petals), combo popup text,
  floating "+N" score text, haptic-like scale bounce on place.
  Sound: tiny WebAudio bleeps for place/clear/combo/gameover (mutable, default on).
- Game-over panel: dim overlay, "No Space Left", score, best, "🌸 Bloom Again",
  "📺 Watch ad to keep going (1 left)".
- Pause overlay while any ad is showing; game state untouched.
- No em dashes anywhere in UI copy (use commas/colons/periods).

## 6. File layout (all under ~/workspace/blockbloom/)
- index.html (markup, loads css/js, meta viewport, theme-color)
- css/style.css
- js/pieces.js — SHAPES list [{cells:[[r,c]..], weight, color}]
- js/game.js — pure logic, NO DOM: createGame(), canPlace(), placePiece(),
  findClears(), applyClear(), scoreMove(), anyFit(), dealTray(), undo, history.
  Must run in Node for tests (guard browser-only code).
- js/generator.js — weighted draw + fairness guarantee + assist bias.
- js/ads.js — AdsProvider interface + DemoAdsProvider + AdPolicy (interstitial caps).
- js/monetization.js — revive logic, power-up grants, remove-ads flag, analytics stub.
- js/audio.js — WebAudio bleeps, mute toggle persisted.
- js/ui.js — rendering, drag&drop, animations, panels.
- js/main.js — wiring.
- test/logic.test.js — Node assertions (no deps): placement validity, clear
  detection (rows+cols simultaneously), scoring math, combo counting, game-over
  detection, generator fairness (1000 deals, assert ≥1 fits), undo, revive restore.
- DESIGN.md — game design + monetization doc (honest accounting of deviations).
- manifest.webmanifest + icon.svg (PWA-ready).
- vercel.json — static config.

## 7. Acceptance criteria
- `node --check` passes on every js file; `node test/logic.test.js` all green.
- New game: drag all 3 pieces, clears animate, score math matches spec.
- Forced near-full board → game over panel appears; revive via demo ad restores
  board and keeps score; restart works.
- Power-ups work; refill via demo rewarded ad grants +3.
- Interstitial appears at most per policy after game overs; skippable.
- No console errors. Works at 360px width and desktop.
- Deployed on Vercel under the stackdgame team; live URL loads the game.
