'use strict';
/* BlockBloom tiny WebAudio bleeps. Mutable, default on, persisted.
 * Fully guarded: safe to load in Node (no AudioContext there). */
(function () {
  var MUTE_KEY = 'bb_mute';

  function loadMuted() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(MUTE_KEY) === '1';
    } catch (e) { /* ignore */ }
    return false;
  }

  function SoundFX() {
    this.muted = loadMuted();
    this._ctx = null;
  }

  SoundFX.prototype.isMuted = function () { return this.muted; };

  SoundFX.prototype.setMuted = function (m) {
    this.muted = !!m;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch (e) { /* ignore */ }
  };

  SoundFX.prototype.toggle = function () {
    this.setMuted(!this.muted);
    return this.muted;
  };

  SoundFX.prototype._ensure = function () {
    if (this._ctx || typeof window === 'undefined') return this._ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { this._ctx = new AC(); } catch (e) { this._ctx = null; }
    return this._ctx;
  };

  /* One short sine/triangle blip. freq in Hz, dur in seconds. */
  SoundFX.prototype.blip = function (freq, dur, type, gain) {
    if (this.muted) return;
    var ctx = this._ensure();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      var t = ctx.currentTime;
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* audio is best-effort */ }
  };

  SoundFX.prototype.place = function () { this.blip(440, 0.09, 'triangle', 0.10); };

  SoundFX.prototype.clear = function (lines) {
    var base = 523 + Math.min(lines, 4) * 110;
    this.blip(base, 0.14, 'sine', 0.12);
    var self = this;
    setTimeout(function () { self.blip(base * 1.335, 0.16, 'sine', 0.10); }, 70);
  };

  SoundFX.prototype.combo = function (n) {
    var base = 660 + Math.min(n, 5) * 60;
    this.blip(base, 0.10, 'triangle', 0.12);
    var self = this;
    setTimeout(function () { self.blip(base * 1.25, 0.12, 'triangle', 0.12); }, 80);
  };

  SoundFX.prototype.gameover = function () {
    var self = this;
    [330, 262, 196].forEach(function (f, i) {
      setTimeout(function () { self.blip(f, 0.22, 'sine', 0.11); }, i * 140);
    });
  };

  SoundFX.prototype.revive = function () {
    var self = this;
    [392, 523, 659].forEach(function (f, i) {
      setTimeout(function () { self.blip(f, 0.14, 'triangle', 0.11); }, i * 90);
    });
  };

  SoundFX.prototype.powerup = function () { this.blip(880, 0.12, 'sine', 0.10); };

  var api = { SoundFX: SoundFX };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    var root = typeof globalThis !== 'undefined' ? globalThis : this;
    root.BlockBloom = root.BlockBloom || {};
    root.BlockBloom.audio = api;
  }
})();
