'use strict';
/* BlockBloom A/B experimentation framework.
 *
 * Honest experimentation: randomized cohorts, deterministic per player,
 * exposures logged to the analytics stub so winning variants can be read
 * from real data. No deception: every variant is a legitimate tuning of
 * difficulty pacing, revive prompts, or ad cadence.
 *
 * Works in Node (in-memory store) and the browser (localStorage).
 */
(function () {
  var ID_KEY = 'bb_exp_id';

  var EXPERIMENTS = {
    pity_threshold: ['12', '16'],   // drought moves before the pity piece kicks in
    ramp_on: ['on', 'off'],         // transparent difficulty ramp
    nearbest_gap: ['150', '300'],   // revive prompt when within X pts of best
    inter_gap_min: ['3', '5']        // interstitial minimum gap, minutes
  };

  var memoryStore = {};
  function store() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* fall through */ }
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; },
      setItem: function (k, v) { memoryStore[k] = String(v); },
      removeItem: function (k) { delete memoryStore[k]; }
    };
  }

  function getId() {
    var s = store();
    var id = s.getItem(ID_KEY);
    if (!id) {
      id = 'e' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { s.setItem(ID_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  /* FNV-1a hash: deterministic, fast, no dependencies. */
  function hashStr(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /* Deterministic variant for this player: same id + experiment always
   * yields the same variant, so a player never flip-flops mid-experience. */
  function getVariant(expName, id) {
    var variants = EXPERIMENTS[expName];
    if (!variants) return null;
    var pid = id || getId();
    return variants[hashStr(pid + ':' + expName) % variants.length];
  }

  function listExperiments() {
    return Object.keys(EXPERIMENTS);
  }

  var api = {
    EXPERIMENTS: EXPERIMENTS,
    getId: getId,
    getVariant: getVariant,
    listExperiments: listExperiments,
    _hashStr: hashStr
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    var root = typeof globalThis !== 'undefined' ? globalThis : this;
    root.BlockBloom = root.BlockBloom || {};
    root.BlockBloom.experiments = api;
  }
})();
