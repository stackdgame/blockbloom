'use strict';
/* BlockBloom ad layer.
 *
 * AdsProvider interface (implement this to plug a real ad network):
 *   isRewardedReady(slot) -> boolean
 *   showRewarded(slot) -> Promise<'completed'|'skipped'|'failed'>
 *   isInterstitialReady() -> boolean
 *   showInterstitial() -> Promise<'closed'|'failed'>
 *
 * Slots used by main.js: 'revive', 'powerup_hammer', 'powerup_undo'.
 *
 * DemoAdsProvider renders a clearly labeled "DEMO AD" card: fullscreen
 * overlay, 5s countdown, then a Continue button. It pauses the game by
 * covering the screen; game state is untouched.
 *
 * AdPolicy enforces the interstitial frequency caps (SPEC 4.1):
 *  - only after game over
 *  - run lasted more than 60 seconds
 *  - at most 1 per 4 minutes
 *  - at most 1 per 3 game overs
 *  - disabled entirely when remove-ads is active
 * Interstitials never interrupt active play.
 */
(function () {
  var INTERSTITIAL_MIN_RUN_SEC = 60;
  var INTERSTITIAL_MIN_GAP_MS = 4 * 60 * 1000;
  var INTERSTITIAL_MIN_GAMEOVERS = 3;
  var DEMO_COUNTDOWN_SEC = 5;

  function store() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* fall through */ }
    return null;
  }

  /* ---------------- DemoAdsProvider ---------------- */
  function DemoAdsProvider() {}

  DemoAdsProvider.prototype.isRewardedReady = function (slot) { return true; };
  DemoAdsProvider.prototype.isInterstitialReady = function () { return true; };

  DemoAdsProvider.prototype._renderCard = function (kind) {
    var root = document.getElementById('ad-root') || document.body;
    var ov = document.createElement('div');
    ov.className = 'ad-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Demo advertisement');
    var title = kind === 'rewarded' ? 'Rewarded ad' : 'Interstitial ad';
    ov.innerHTML =
      '<div class="ad-card">' +
        '<div class="ad-label">DEMO AD</div>' +
        '<div class="ad-title">' + title + '</div>' +
        '<div class="ad-body">This is a placeholder. A real ad from your ad ' +
        'network would play here. See DESIGN.md for how to connect a real ' +
        'network and start earning.</div>' +
        '<div class="ad-countdown">Continue available in <span>5</span>s</div>' +
        '<div class="ad-actions">' +
          '<button class="ad-btn ad-continue" disabled>Continue</button>' +
          '<button class="ad-btn ad-close">Close</button>' +
        '</div>' +
      '</div>';
    root.appendChild(ov);
    return ov;
  };

  DemoAdsProvider.prototype._runDemo = function (kind, doneLabel) {
    var self = this;
    return new Promise(function (resolve) {
      if (typeof document === 'undefined') { resolve('failed'); return; }
      var ov = self._renderCard(kind);
      var countEl = ov.querySelector('.ad-countdown span');
      var continueBtn = ov.querySelector('.ad-continue');
      var closeBtn = ov.querySelector('.ad-close');
      var remaining = DEMO_COUNTDOWN_SEC;
      var settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        resolve(result);
      }
      continueBtn.addEventListener('click', function () { cleanup(doneLabel); });
      closeBtn.addEventListener('click', function () {
        // Closing early on a rewarded ad counts as skipped (no reward).
        cleanup(kind === 'rewarded' ? 'skipped' : 'closed');
      });
      var timer = setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(timer);
          ov.querySelector('.ad-countdown').textContent = 'Thanks for watching the demo.';
          continueBtn.disabled = false;
          continueBtn.focus();
        } else {
          countEl.textContent = String(remaining);
        }
      }, 1000);
    });
  };

  DemoAdsProvider.prototype.showRewarded = function (slot) {
    return this._runDemo('rewarded', 'completed');
  };

  DemoAdsProvider.prototype.showInterstitial = function () {
    return this._runDemo('interstitial', 'closed');
  };

  /* ---------------- AdPolicy ---------------- */
  var POLICY_KEY = 'bb_adpolicy';

  function loadPolicy() {
    var s = store();
    var def = { lastInterstitialAt: 0, gameOversSinceAd: 0 };
    if (!s) return def;
    try {
      var raw = JSON.parse(s.getItem(POLICY_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          lastInterstitialAt: raw.lastInterstitialAt || 0,
          gameOversSinceAd: raw.gameOversSinceAd || 0
        };
      }
    } catch (e) { /* fall through */ }
    return def;
  }

  function savePolicy(p) {
    var s = store();
    if (!s) return;
    try { s.setItem(POLICY_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  function isRemoveAdsActive() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.BlockBloom && globalThis.BlockBloom.monetization) {
        return globalThis.BlockBloom.monetization.hasRemoveAds();
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  var AdPolicy = {
    INTERSTITIAL_MIN_RUN_SEC: INTERSTITIAL_MIN_RUN_SEC,
    INTERSTITIAL_MIN_GAP_MS: INTERSTITIAL_MIN_GAP_MS,
    INTERSTITIAL_MIN_GAMEOVERS: INTERSTITIAL_MIN_GAMEOVERS,

    recordGameOver: function () {
      var p = loadPolicy();
      p.gameOversSinceAd += 1;
      savePolicy(p);
      return p;
    },

    shouldShowInterstitial: function (runDurationSec, nowMs) {
      if (isRemoveAdsActive()) return false;
      if (!(runDurationSec > INTERSTITIAL_MIN_RUN_SEC)) return false;
      var p = loadPolicy();
      var now = (typeof nowMs === 'number') ? nowMs : Date.now();
      if (now - p.lastInterstitialAt < INTERSTITIAL_MIN_GAP_MS) return false;
      if (p.gameOversSinceAd < INTERSTITIAL_MIN_GAMEOVERS) return false;
      return true;
    },

    markShown: function (nowMs) {
      var p = loadPolicy();
      p.lastInterstitialAt = (typeof nowMs === 'number') ? nowMs : Date.now();
      p.gameOversSinceAd = 0;
      savePolicy(p);
      return p;
    },

    reset: function () {
      savePolicy({ lastInterstitialAt: 0, gameOversSinceAd: 0 });
    }
  };

  var api = {
    DemoAdsProvider: DemoAdsProvider,
    AdPolicy: AdPolicy,
    demo: null // set by main.js to a DemoAdsProvider instance
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    var root = typeof globalThis !== 'undefined' ? globalThis : this;
    root.BlockBloom = root.BlockBloom || {};
    root.BlockBloom.ads = api;
  }
})();
