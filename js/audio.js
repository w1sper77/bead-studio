/* 轻量 WebAudio 音效，无外部音频文件 */
(function () {
  "use strict";

  let ctx = null;
  let master = null;
  let muted = false;
  let vibrateOn = true;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, gain, sweepTo) {
    if (muted) return;
    const ac = ensure();
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.06, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, gain, filterFreq) {
    if (muted) return;
    const ac = ensure();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = filterFreq || 900;
    bp.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.value = gain || 0.04;
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start();
  }

  const Audio = {
    setMuted(v) { muted = !!v; },
    isMuted() { return muted; },
    setVibration(v) { vibrateOn = !!v; },
    vibrate(ms) {
      if (vibrateOn && navigator.vibrate) navigator.vibrate(ms || 12);
    },
    unlock() { ensure(); },
    pop(step) {
      const base = 540 + Math.min(10, step || 0) * 18;
      tone(base, 0.07, "sine", 0.05, base * 1.55);
      tone(base * 1.5, 0.035, "triangle", 0.018);
    },
    error() {
      tone(190, 0.1, "sawtooth", 0.032, 130);
      setTimeout(() => tone(120, 0.14, "sine", 0.028, 90), 60);
      if (vibrateOn && navigator.vibrate) navigator.vibrate(24);
    },
    tick() {
      tone(300, 0.03, "square", 0.012, 240);
    },
    pick() {
      tone(760, 0.08, "sine", 0.035, 980);
    },
    save() {
      tone(660, 0.04, "sine", 0.012);
    },
    complete() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, "sine", 0.05), i * 95));
    },
    iron() {
      noise(1.2, 0.035, 700);
    },
    finish() {
      [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.3, "triangle", 0.035), i * 110));
      noise(0.5, 0.02, 2400);
    }
  };

  window.Sfx = Audio;
})();
