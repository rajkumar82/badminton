// All sounds are synthesised with WebAudio (noise bursts and short tones), so there are no audio files to load.
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
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
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
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out(x));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  function tone({ f0, f1, dur, type = 'sine', gain = 0.2, x, delay = 0, attack = 0.003 }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out(x));
    o.start(t); o.stop(t + dur + 0.02);
  }

  const api = {
    unlock() { init(); },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('bm-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.value = m ? 0 : 0.8;
    },

    // the cork meeting the strings: a sharp "thock" plus a little string ring. Harder shots are louder and crisper.
    hit(type, power, x) {
      if (!ctx || muted) return;
      const p = Math.max(0.2, Math.min(1, power));
      noise({ dur: 0.05, freq: 2600 + p * 1500, q: 0.9, gain: 0.45 + p * 0.5, x });
      tone({ f0: 1300 + p * 500, f1: 380, dur: 0.1, gain: 0.3 + p * 0.25, type: 'triangle', x });
      tone({ f0: 2300, f1: 1900, dur: 0.16, gain: 0.05 + p * 0.05, type: 'sine', x });
      if (type === 'smash') {
        noise({ dur: 0.09, type: 'highpass', freq: 5200, gain: 0.5, x });
        noise({ dur: 0.18, type: 'lowpass', freq: 380, gain: 0.7, x });
        tone({ f0: 190, f1: 70, dur: 0.2, gain: 0.5, x });
      } else if (type === 'drop') {
        noise({ dur: 0.03, freq: 3500, gain: 0.12, x });
      }
    },
    swing(x) { if (ctx && !muted) noise({ dur: 0.17, freq: 500, freqEnd: 2200, q: 1.4, gain: 0.1, attack: 0.05, x }); },
    net(p, x) {
      if (!ctx || muted) return;
      noise({ dur: 0.16, type: 'lowpass', freq: 600, gain: 0.35 + p * 0.3, x });
      tone({ f0: 150, f1: 85, dur: 0.18, gain: 0.25, x });
    },
    floor(p, x) {
      if (!ctx || muted) return;
      noise({ dur: 0.05, freq: 1300, q: 1.2, gain: 0.25 + p * 0.2, x });
      tone({ f0: 320, f1: 150, dur: 0.06, gain: 0.18, x });
    },
    jump(x) { if (ctx && !muted) { noise({ dur: 0.07, type: 'lowpass', freq: 500, gain: 0.12, x }); } },
    land(x) { if (ctx && !muted) { noise({ dur: 0.08, type: 'lowpass', freq: 380, gain: 0.2, x }); tone({ f0: 130, f1: 80, dur: 0.09, gain: 0.12, x }); } },

    // a rising chime when you win the point, a falling one when you lose it, and a little crowd noise either way
    point(won) {
      if (!ctx || muted) return;
      const notes = won ? [660, 880] : [440, 330];
      notes.forEach((f, i) => tone({ f0: f, dur: 0.38, gain: 0.16, type: 'sine', delay: 0.05 + i * 0.13 }));
      noise({ dur: 0.9, freq: 1500, q: 0.4, gain: won ? 0.12 : 0.05, attack: 0.25, delay: 0.1 });
    },
    fanfare(won) {
      if (!ctx || muted) return;
      const notes = won ? [523, 659, 784, 1047, 1319] : [392, 349, 330, 262];
      notes.forEach((f, i) => tone({ f0: f, dur: 0.5, gain: 0.17, type: won ? 'triangle' : 'sine', delay: i * 0.14 }));
      if (won) noise({ dur: 2, freq: 1700, q: 0.3, gain: 0.2, attack: 0.5, delay: 0.3 });
    },
    blip() { if (ctx && !muted) tone({ f0: 880, f1: 1320, dur: 0.07, gain: 0.1, type: 'square' }); },
  };
  return api;
})();
