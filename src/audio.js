/* Tiny WebAudio synth - every sound is generated, nothing to download. Off until the visitor turns it on. */
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let ambient = null;
  let on = false;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const now = () => ctx.currentTime;

  function noise() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    return s;
  }

  function envelope(param, t, attack, peak, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone(type, f0, f1, t, dur, vol) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    envelope(g.gain, t, 0.01, vol, dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  function hiss(t, dur, type, freq, q, vol, freqEnd) {
    const s = noise();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    envelope(g.gain, t, Math.min(0.02, dur / 4), vol, dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  function startAmbient() {
    const s = noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.14;
    const depth = ctx.createGain();
    depth.gain.value = 0.035;
    lfo.connect(depth).connect(g.gain);
    s.connect(lp).connect(g).connect(master);
    s.start();
    lfo.start();
    ambient = { s, lfo };
  }

  const sounds = {
    laugh() {             // shi-shi-shi
      const t = now();
      for (let i = 0; i < 3; i++) {
        hiss(t + i * 0.12, 0.07, 'bandpass', 4200, 1.4, 0.32);
        tone('triangle', 520 + i * 70, 600 + i * 70, t + i * 0.12, 0.06, 0.07);
      }
    },
    blush() {
      const t = now();
      tone('sine', 660, 990, t, 0.25, 0.08);
      tone('sine', 990, 1320, t + 0.12, 0.25, 0.05);
    },
    wind() {
      hiss(now(), 1.6, 'bandpass', 280, 0.9, 0.55, 1900);
    },
    stretch() {           // a rubbery boing
      const t = now();
      const o = tone('sine', 150, 560, t, 0.55, 0.22);
      const v = ctx.createOscillator();
      const vg = ctx.createGain();
      v.frequency.value = 16;
      vg.gain.value = 30;
      v.connect(vg).connect(o.frequency);
      v.start(t);
      v.stop(t + 0.6);
    },
    catch() {
      const t = now();
      tone('triangle', 880, 880, t, 0.12, 0.08);
      tone('triangle', 1320, 1320, t + 0.07, 0.18, 0.07);
    },
    don() {
      const t = now();
      tone('sine', 110, 42, t, 0.5, 0.8);
      tone('triangle', 220, 90, t, 0.18, 0.3);
      hiss(t, 0.3, 'lowpass', 1100, 0.7, 0.5);
    },
    meat() {              // chomp chomp
      const t = now();
      for (let i = 0; i < 3; i++) hiss(t + i * 0.13, 0.06, 'lowpass', 1600, 1, 0.45);
    },
    splash() {
      hiss(now(), 0.35, 'bandpass', 1400, 0.8, 0.3, 500);
    },
    star() {
      const t = now();
      tone('sine', 1760, 1760, t, 0.3, 0.05);
      tone('sine', 2637, 2637, t + 0.06, 0.35, 0.04);
    },
  };

  return {
    get enabled() { return on; },
    setEnabled(v) {
      on = v;
      if (v) {
        init();
        ctx.resume();
        if (!ambient) startAmbient();
      } else if (ambient) {
        ambient.s.stop();
        ambient.lfo.stop();
        ambient = null;
      }
    },
    play(name) {
      if (!on || !ctx || !sounds[name]) return;
      sounds[name]();
    },
  };
}
