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
  /* ---------------- AdPolicy ----------------
   * Smart interstitial pacing:
   *  - only after game over (never interrupts active play)
   *  - the run lasted at least INTERSTITIAL_MIN_RUN_SEC seconds
   *  - at least interGapMs since the last interstitial (experiment-tuned)
   *  - SKIPPED when the player watched a rewarded ad in the last
   *    REWARDED_COOLDOWN_MS: engaged players get fewer forced ads, which
   *    keeps them around to watch more chosen (higher-eCPM) rewarded ads
   *  - at most INTERSTITIAL_MAX_PER_SESSION per session
   *  - disabled entirely when remove-ads is active
   */
  var INTERSTITIAL_MIN_RUN_SEC = 90;
  var INTERSTITIAL_DEFAULT_GAP_MS = 3 * 60 * 1000;
  var INTERSTITIAL_MAX_PER_SESSION = 4;
  var REWARDED_COOLDOWN_MS = 5 * 60 * 1000;
  var DEMO_COUNTDOWN_SEC = 5;

  var memoryStore = {};
  function store() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* fall through */ }
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; },
      setItem: function (k, v) { memoryStore[k] = String(v); },
      removeItem: function (k) { delete memoryStore[k]; },
      _clear: function () { for (var k in memoryStore) delete memoryStore[k]; }
    };
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
  var POLICY_KEY = 'bb_adpolicy_v2';

  function loadPolicy() {
    var s = store();
    var def = {
      lastInterstitialAt: 0,
      lastRewardedAt: 0,
      sessionInterstitials: 0,
      sessionId: 0
    };
    if (!s) return def;
    try {
      var raw = JSON.parse(s.getItem(POLICY_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          lastInterstitialAt: raw.lastInterstitialAt || 0,
          lastRewardedAt: raw.lastRewardedAt || 0,
          sessionInterstitials: raw.sessionInterstitials || 0,
          sessionId: raw.sessionId || 0
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
    INTERSTITIAL_DEFAULT_GAP_MS: INTERSTITIAL_DEFAULT_GAP_MS,
    INTERSTITIAL_MAX_PER_SESSION: INTERSTITIAL_MAX_PER_SESSION,
    REWARDED_COOLDOWN_MS: REWARDED_COOLDOWN_MS,

    /* Call once per app boot. Resets the per-session interstitial counter. */
    newSession: function () {
      var p = loadPolicy();
      p.sessionId = Date.now();
      p.sessionInterstitials = 0;
      savePolicy(p);
      return p;
    },

    /* Call whenever a rewarded ad completes: suppresses interstitials
     * for REWARDED_COOLDOWN_MS. */
    recordRewarded: function (nowMs) {
      var p = loadPolicy();
      p.lastRewardedAt = (typeof nowMs === 'number') ? nowMs : Date.now();
      savePolicy(p);
      return p;
    },

    shouldShowInterstitial: function (runDurationSec, opts) {
      opts = opts || {};
      if (isRemoveAdsActive()) return false;
      if (!(runDurationSec > INTERSTITIAL_MIN_RUN_SEC)) return false;
      var gapMs = opts.gapMs || INTERSTITIAL_DEFAULT_GAP_MS;
      var now = (typeof opts.nowMs === 'number') ? opts.nowMs : Date.now();
      var p = loadPolicy();
      if (now - p.lastInterstitialAt < gapMs) return false;
      if (p.sessionInterstitials >= INTERSTITIAL_MAX_PER_SESSION) return false;
      if (now - p.lastRewardedAt < REWARDED_COOLDOWN_MS) return false;
      return true;
    },

    markShown: function (nowMs) {
      var p = loadPolicy();
      p.lastInterstitialAt = (typeof nowMs === 'number') ? nowMs : Date.now();
      p.sessionInterstitials += 1;
      savePolicy(p);
      return p;
    },

    reset: function () {
      savePolicy({ lastInterstitialAt: 0, lastRewardedAt: 0, sessionInterstitials: 0, sessionId: 0 });
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
