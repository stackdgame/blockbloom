# BlockBloom: Game Design and Monetization

**BlockBloom by stackdgame.** Tagline: "Plant blocks. Bloom combos."
A cozy 8x8 block puzzle in the Block Blast family: drag pieces from a 3-piece
tray onto the board, fill full rows or columns to bloom them away, chain
clears for combos. Light garden theme (warm cream, soft sage, petal tones),
original art, original code. Not affiliated with any other game.

## 1. Core loop

1. Drag one of 3 tray pieces onto the 8x8 board. A ghost preview follows the
   pointer; the placement preview is green when legal, red when illegal.
2. Release over a legal cell: the piece locks in. Illegal or off-board release:
   the piece snaps back to the tray.
3. Full rows and columns clear simultaneously with a bloom animation (scale/pop
   plus petal particles).
4. Placing all 3 tray pieces deals 3 new pieces.
5. When no remaining tray piece fits anywhere on the board, the run ends
   ("No Space Left").

## 2. Scoring (single source of truth: `SCORING` in js/game.js)

- Placement: `cells placed * 1`
- Clear: `clearedCells * 10 * linesCleared` (a 2-line clear pays 2x per cell)
- Combo: consecutive moves that clear at least one line increment the combo;
  a move with no clear resets it to 0.
  `comboBonus = 50 * combo * linesCleared`
- Score is never taken away.

Example: placing a 1x1 that completes one row of 8 pays
1 + 8*10*1 + 50*1*1 = 131. A second immediate line clear pays combo x2.

## 3. Pieces

35 shapes across the classic families: 1x1, dominoes, 3/4/5 lines, 2x2 and 3x3
squares, 2x3 and 3x2 rectangles, small L (4 rotations), L tetromino (4),
3x3 corner of 5 cells (4), T tetromino (4), T pentomino, S and Z tetrominoes (2
each), plus pentomino. Small pieces spawn more often (higher weights).

## 4. Fairness: deliberate deviations from the reference video

The reference video describes two practices we deliberately do NOT implement:

1. **No rigged deaths.** The video describes a "death algorithm" that deals
   unplayable pieces when a high-value ad is ready. BlockBloom never does this.
   The generator (js/generator.js) draws 3 weighted-random pieces, verifies at
   least one fits somewhere on the board, redraws up to 25 times, and otherwise
   forces one slot to a 1x1 (which fits whenever any cell is empty). Game over
   happens if and only if the board is genuinely unplayable. This is tested:
   1000 random deals over 1000 random boards, every deal has a fitting piece.

2. **No device-data worth model.** The video describes harvesting phone model,
   country, and settings to predict ad worth. BlockBloom collects nothing of
   the sort. There is no fingerprinting, no device profiling, no hidden
   behavior model anywhere in the codebase.

3. **Documented assist, player-friendly and disclosed.** When board fill
   exceeds 55%, small-piece spawn weights get a 1.5x boost. This only ever
   helps a struggling player find a fit; it never harms them and it never
   triggers or hastens a death.

4. **Revive keeps 100% of score.** The video's version restores roughly 10% of
   score after a full ad view. Our rewarded revive restores the board to the
   state 3 moves ago (or clears 14 random cells when history is short), keeps
   100% of the score, resets combo to 0, and redeals a fair tray. Max 1 revive
   per run.

## 5. Power-ups

- **Hammer** (start: 3): arm it, tap any filled cell, the cell smashes clear.
- **Undo** (start: 3): reverts the board, tray, score, and combo to the state
  before the last placement (the tray piece is refunded).
- Running out: the "+3" button next to each power-up plays a rewarded ad and
  grants +3 of that power-up.
- Counts persist in localStorage.

## 6. Monetization architecture

### 6.1 Rewarded revive (player's choice)
On game over: "Watch ad to keep going (1 left)". Ad completes: revive per
section 4.4 above. Skipping or closing early returns to the game-over panel
with no reward and no penalty.

### 6.2 Rewarded power-up refills
"+3" buttons for hammer and undo. Same rewarded flow: completed ad grants +3.

### 6.3 Interstitials (frequency-capped, never mid-play)
Shown only after game over, and only when ALL of these hold:
- the run lasted more than 60 seconds,
- at least 4 minutes since the last interstitial,
- at least 3 game overs since the last interstitial.
Skippable after 5 seconds (in the demo: a Continue button appears after the
countdown; closing early just closes it).

### 6.4 Remove-ads hook
`monetization.hasRemoveAds()` (localStorage flag `bb_remove_ads`, default
false) disables interstitials entirely. Purchase wiring is left for the
native-wrapper phase: when a purchase completes, call
`monetization.setRemoveAds(true)`.

### 6.5 Analytics stub
Every monetization event (`run_start`, `deal`, `game_over`, `ad_shown`,
`ad_completed`, `ad_skipped`, `ad_closed`, `revive_used`, `powerup_earned`,
`powerup_used`) is logged to the console and to a localStorage ring buffer
(`bb_analytics`, max 100 entries), ready to forward to a real analytics
endpoint. Hook into `monetization.logEvent()` to forward.

### 6.6 AdsProvider interface (js/ads.js)
```js
{
  isRewardedReady(slot): boolean,
  showRewarded(slot): Promise<'completed'|'skipped'|'failed'>,
  isInterstitialReady(): boolean,
  showInterstitial(): Promise<'closed'|'failed'>
}
```
Slots used: `'revive'`, `'powerup_hammer'`, `'powerup_undo'`.
`DemoAdsProvider` (shipped) renders a clearly labeled "DEMO AD" card with a
5s countdown, then Continue/Close. Fullscreen overlay; the game is paused
underneath and game state is untouched.

## 7. Making real money: what Milan needs

No real ad network is wired in. Two honest paths, pick one:

**Option A (web, fastest):** sign up for a web rewarded-video ad network that
supports mobile web (examples to evaluate: AdSense for Games / H5, or a
rewarded-video provider with an HTML5 SDK), create the account as
stackdgame@gmail.com, get the publisher/SDK key, then implement the
`AdsProvider` interface in js/ads.js with their SDK (roughly 60 lines:
`showRewarded` resolves `'completed'` on the SDK's reward callback). Swap
`new ads.DemoAdsProvider()` for the real provider in js/main.js. Keep the
DEMO provider behind a flag for testing.

**Option B (app stores, higher eCPM):** wrap the game with Capacitor, add the
AdMob plugin, create an AdMob account as stackdgame@gmail.com, create rewarded
and interstitial ad unit IDs, and implement `AdsProvider` against the plugin's
rewarded/interstitial APIs. Same interface, same call sites.

Do not invent a working network: until a real account and SDK key exist, all
ads remain clearly labeled demos and earn nothing.

## 8. File map

- `index.html`, `css/style.css`: shell and garden theme.
- `js/pieces.js`: 35 shapes with spawn weights and colors.
- `js/game.js`: pure logic, zero DOM (runs in Node for tests):
  `createGame`, `canPlace`, `placePiece`, `findClears`, `applyClear`,
  `scoreMove`, `anyFit`, `dealTray`, `checkGameOver`, `undo`, `hammerCell`.
- `js/generator.js`: weighted draw, fairness guarantee, assist bias.
- `js/ads.js`: `AdsProvider` interface, `DemoAdsProvider`, `AdPolicy` caps.
- `js/monetization.js`: revive, power-up grants, remove-ads flag, analytics.
- `js/audio.js`: WebAudio bleeps, mutable, persisted.
- `js/ui.js`: rendering, Pointer Events drag and drop, animations, panels.
- `js/main.js`: wiring.
- `test/logic.test.js`: 20 Node assertions, no dependencies.
- `manifest.webmanifest`, `icon.svg`: PWA-ready. `vercel.json`: static hosting.

## 9. Tuning notes

- `ASSIST_FILL` / `ASSIST_BOOST` (generator.js): assist threshold and strength.
- `MAX_REDRAWS` (generator.js): fairness redraw budget.
- `HISTORY_LIMIT` (game.js): undo/revive depth (8).
- `MAX_REVIVES_PER_RUN` (monetization.js): 1.
- `INTERSTITIAL_MIN_RUN_SEC` / `INTERSTITIAL_MIN_GAP_MS` /
  `INTERSTITIAL_MIN_GAMEOVERS` (ads.js): interstitial caps.
