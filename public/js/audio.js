// All sounds are synthesised with WebAudio, so there are no audio files to load. They are built the way the real
// ones are made: a hit is a sharp click (cork meeting strings), the ring of the string bed (a few quickly dying
// tones), a short thump from the cork and a faint rustle from the feathers. Shoes squeak and thud on the court,
// and the crowd cheers when a point ends.
const Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('bm-muted') === '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    // a gentle limiter so a smash is loud without distorting
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // x is the court position in metres; sounds pan left/right with the action
  function out(x) {
    if (x === undefined || !ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, (x - 6.7) / 8));
    p.connect(master);
    return p;
  }

  function noise({ dur, type = 'bandpass', freq = 2000, q = 1, gain = 0.3, freqEnd, attack = 0.002, x, delay = 0 }) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out(x));
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
  }

  function tone({ f0, f1, dur, type = 'sine', gain = 0.2, x, delay = 0, attack = 0.002 }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out(x));
    o.start(t); o.stop(t + dur + 0.02);
  }

  // the shuttle meeting the strings: click, string-bed ring, cork thump, feather rustle
  function strike({ power, x, bright = 1, body = 1, ring = 1 }) {
    const p = Math.max(0.15, Math.min(1, power));
    // 1. the click: a few thousandths of a second of bright noise
    noise({ dur: 0.012, type: 'highpass', freq: 2200 * bright, gain: 0.35 + 0.65 * p, attack: 0.0004, x });
    noise({ dur: 0.03, type: 'bandpass', freq: 3200 * bright, q: 0.8, gain: 0.25 + 0.45 * p, attack: 0.0006, x });
    // 2. the string bed rings at a few frequencies and dies away quickly (harder hits ring higher and louder)
    const base = (1050 + 380 * p) * bright;
    [[1, 0.05, 0.34], [1.53, 0.04, 0.2], [2.27, 0.03, 0.14], [3.1, 0.022, 0.08]].forEach(([m, dec, g], i) => {
      tone({ f0: base * m * (1 + (Math.random() - 0.5) * 0.02), f1: base * m * 0.985, dur: dec * ring, gain: g * (0.35 + 0.8 * p), x, attack: 0.0008, delay: i * 0.0004 });
    });
    // 3. the cork's thump
    tone({ f0: 520, f1: 190, dur: 0.04, gain: (0.3 + 0.35 * p) * body, x, attack: 0.0008 });
    // 4. feathers
    noise({ dur: 0.07, type: 'bandpass', freq: 6500, q: 0.6, gain: 0.05 + 0.08 * p, attack: 0.004, x, delay: 0.004 });
  }

  const api = {
    unlock() { init(); },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('bm-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.value = m ? 0 : 0.85;
    },

    hit(type, power, x) {
      if (!ctx || muted) return;
      if (type === 'smash') {
        // a smash is the loudest, crispest sound in the game: a hard crack with a snap of air
        strike({ power: 1, x, bright: 1.3, body: 1.4, ring: 0.8 });
        noise({ dur: 0.02, type: 'highpass', freq: 4800, gain: 1, attack: 0.0003, x });
        noise({ dur: 0.14, type: 'lowpass', freq: 320, gain: 0.6, x });
        tone({ f0: 210, f1: 70, dur: 0.16, gain: 0.45, x });
      } else if (type === 'drop' || type === 'serve') {
        strike({ power: type === 'serve' ? 0.4 : 0.3, x, bright: 0.88, body: 0.7, ring: 0.9 });   // a soft "tok"
      } else if (type === 'lift') {
        strike({ power: 0.6, x, bright: 0.95, body: 1.1 });
      } else {
        strike({ power: Math.max(0.5, power), x, bright: 1, body: 1 });   // clears and drives: a clean "pock"
      }
    },

    // the racket cutting the air: a rising, fading swish
    swing(x) {
      if (!ctx || muted) return;
      noise({ dur: 0.2, type: 'bandpass', freq: 600, freqEnd: 2800, q: 2.2, gain: 0.16, attack: 0.08, x });
      noise({ dur: 0.16, type: 'highpass', freq: 3500, gain: 0.04, attack: 0.07, x });
    },

    // shuttle brushing the net tape
    net(p, x) {
      if (!ctx || muted) return;
      noise({ dur: 0.12, type: 'lowpass', freq: 900, gain: 0.25 + p * 0.25, x });
      noise({ dur: 0.05, type: 'highpass', freq: 3000, gain: 0.08, x });
      tone({ f0: 210, f1: 120, dur: 0.09, gain: 0.18, x });
    },

    // shuttle landing on the floor: a small dry tick
    floor(p, x) {
      if (!ctx || muted) return;
      noise({ dur: 0.025, type: 'bandpass', freq: 3200, q: 1.1, gain: 0.18 + p * 0.18, attack: 0.0005, x });
      tone({ f0: 1100, f1: 520, dur: 0.03, gain: 0.1 + p * 0.1, x, attack: 0.0006 });
    },

    // shoes on the court
    step(x, v = 1) {
      if (!ctx || muted) return;
      noise({ dur: 0.04, type: 'lowpass', freq: 700, gain: 0.07 + 0.08 * v, attack: 0.002, x });
      if (Math.random() < 0.18) api.squeak(x, 0.5);
    },
    squeak(x, scale = 1) {
      if (!ctx || muted) return;
      const f = 1500 + Math.random() * 900;
      tone({ f0: f, f1: f * (1.25 + Math.random() * 0.3), dur: 0.07 + Math.random() * 0.06, type: 'sawtooth', gain: 0.025 * scale, x, attack: 0.008 });
      noise({ dur: 0.09, type: 'bandpass', freq: f * 1.5, q: 5, gain: 0.03 * scale, x, attack: 0.01 });
    },
    jump(x) { if (ctx && !muted) { noise({ dur: 0.06, type: 'lowpass', freq: 600, gain: 0.1, x }); api.squeak(x, 0.7); } },
    land(x) { if (ctx && !muted) { noise({ dur: 0.07, type: 'lowpass', freq: 420, gain: 0.2, x }); tone({ f0: 140, f1: 80, dur: 0.08, gain: 0.12, x }); } },

    // a rising chime when you win the point, a falling one when you lose it, and the crowd either way
    point(won) {
      if (!ctx || muted) return;
      const notes = won ? [660, 880] : [440, 330];
      notes.forEach((f, i) => tone({ f0: f, dur: 0.38, gain: 0.14, type: 'sine', delay: 0.05 + i * 0.13 }));
      noise({ dur: 1.1, freq: 1500, q: 0.4, gain: won ? 0.12 : 0.05, attack: 0.3, delay: 0.1 });
      // a few claps
      if (won) for (let i = 0; i < 7; i++) noise({ dur: 0.03, type: 'bandpass', freq: 2200 + Math.random() * 1500, q: 0.8, gain: 0.05, delay: 0.25 + Math.random() * 0.7 });
    },
    fanfare(won) {
      if (!ctx || muted) return;
      const notes = won ? [523, 659, 784, 1047, 1319] : [392, 349, 330, 262];
      notes.forEach((f, i) => tone({ f0: f, dur: 0.5, gain: 0.15, type: won ? 'triangle' : 'sine', delay: i * 0.14 }));
      if (won) noise({ dur: 2.2, freq: 1700, q: 0.3, gain: 0.2, attack: 0.5, delay: 0.3 });
    },
    blip() { if (ctx && !muted) tone({ f0: 880, f1: 1320, dur: 0.07, gain: 0.08, type: 'square' }); },
  };
  return api;
})();
