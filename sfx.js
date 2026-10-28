'use strict';
// 音效和配乐：移植自 pp/audio.py，全部在浏览器里现场合成，不加载任何音频文件。

const SFX = (() => {
  const SR = 44100;
  let ac = null, master = null, ambGain = null, ambSrc = null, muted = false, paused = false;
  let ambientWanted = false, musicSrc = null, musicGain = null, musicQueued = false, musicScene = 'boot';
  const cache = new Map();

  const N = (d) => Math.max(1, Math.floor(d * SR));

  function rng(seed) {
    let a = (seed * 2654435761) >>> 0 || 1;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function noise(n, seed) {
    const r = rng(seed + 7), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (r() + r() + r() + r() - 2) * 1.7;
    return x;
  }

  // 二阶 Butterworth（RBJ biquad）；带通 = 高通 + 低通 串联
  function biquad(x, type, f) {
    f = Math.min(f, SR * 0.45);
    const w0 = 2 * Math.PI * f / SR, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2);
    let b0, b1, b2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
    }
    return y;
  }

  function filt(x, kind, f) {
    if (kind === 'bandpass') return biquad(biquad(x, 'highpass', f[0]), 'lowpass', f[1]);
    return biquad(x, kind, f);
  }

  const lin = (a, b, n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = a + (b - a) * i / Math.max(1, n - 1); return x; };

  function phase(freq, n) {
    const p = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += (typeof freq === 'number' ? freq : freq[i]); p[i] = 2 * Math.PI * acc / SR; }
    return p;
  }

  function square(freq, n, duty = 0.5) {
    const p = phase(freq, n), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = ((p[i] / (2 * Math.PI)) % 1) < duty ? 1 : -1;
    return x;
  }

  function tri(freq, n) {
    const p = phase(freq, n), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 4 * Math.abs(((p[i] / (2 * Math.PI)) % 1) - 0.5) - 1;
    return x;
  }

  function sine(freq, n) { const p = phase(freq, n); return p.map(Math.sin); }

  function decay(n, tau) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.exp(-i / (tau * SR)); return x; }

  const mul = (a, b) => { const x = new Float32Array(a.length); for (let i = 0; i < a.length; i++) x[i] = a[i] * (typeof b === 'number' ? b : b[i]); return x; };
  const add = (a, b, g = 1) => { const x = new Float32Array(a.length); for (let i = 0; i < a.length; i++) x[i] = a[i] + (i < b.length ? b[i] * g : 0); return x; };

  function fade(x, a = 0.004, r = 0.02) {
    const n = x.length, y = new Float32Array(n), A = Math.max(1, a * SR), R = Math.max(1, r * SR);
    for (let i = 0; i < n; i++) y[i] = x[i] * Math.min(1, i / A) * Math.min(1, (n - i) / R);
    return y;
  }

  function norm(x, peak = 1) {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    return m > 0 ? mul(x, peak / m) : x;
  }

  function cat(...parts) {
    const n = parts.reduce((s, p) => s + p.length, 0), x = new Float32Array(n);
    let o = 0;
    for (const p of parts) { x.set(p, o); o += p.length; }
    return x;
  }

  function place(out, t, x, g = 1) {
    const p = N(t);
    for (let i = 0; i < x.length && p + i < out.length; i++) out[p + i] += x[i] * g;
  }

  // ———————————————— 人声 / 环境 ————————————————

  function mumble(dur, pitch, seed, peak = 0.3) {
    const r = rng(seed * 31 + 5), out = new Float32Array(N(dur));
    const uni = (a, b) => a + (b - a) * r();
    let pos = 0;
    while (pos < out.length) {
      const n = Math.min(N(uni(0.06, 0.12)), out.length - pos);
      if (n < 64) break;
      const f0 = pitch * uni(0.85, 1.2);
      const glide = lin(f0, f0 * uni(0.85, 1.1), n);
      const p = phase(glide, n), saw = new Float32Array(n);
      for (let i = 0; i < n; i++) saw[i] = ((p[i] / (2 * Math.PI)) % 1) * 2 - 1;
      const f1 = uni(450, 850), f2 = uni(1100, 2200);
      const v = add(filt(saw, 'bandpass', [f1 * 0.7, f1 * 1.3]), filt(saw, 'bandpass', [f2 * 0.8, f2 * 1.2]), 0.6);
      out.set(fade(v, 0.012, 0.03).map((s, i) => s + out[pos + i]), pos);
      pos += n + N(uni(0.015, 0.05));
    }
    return norm(filt(out, 'lowpass', 3500), peak);
  }

  function ambient() {
    const n = N(8);
    const wind = mul(filt(noise(n, 1), 'lowpass', 380), 3);
    const crowd = filt(noise(n, 2), 'bandpass', [220, 900]);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      crowd[i] *= 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t) * Math.sin(2 * Math.PI * 0.125 * t + 1);
    }
    return fade(norm(add(wind, crowd, 0.6), 0.06), 0.3, 0.3);
  }

  function intercom() {
    const n = N(0.5);
    let v = cat(new Float32Array(N(0.04)), mumble(0.42, 150, 11, 1.0), new Float32Array(n)).slice(0, n);
    v = filt(add(v, noise(n, 12), 0.08), 'bandpass', [350, 2600]).map((s) => Math.tanh(s * 4));
    const ck = noise(N(0.006), 13);
    return norm(add(v, ck, 0.5), 0.4);
  }

  // ———————————————— 桌面音效 ————————————————

  function footstep(seed) {
    const n = N(0.06);
    let x = mul(filt(noise(n, seed), 'lowpass', 900), decay(n, 0.012));
    x = add(x, mul(sine(90, n), decay(n, 0.02)), 0.6);
    return norm(x, 0.16);
  }

  function paper(seed = 0) {
    const n = N(0.18), r = rng(seed + 100);
    const x = filt(noise(n, seed + 100), 'bandpass', [1800, 7000]);
    const crinkle = new Float32Array(n);
    for (let i = 0; i < n; i++) crinkle[i] = r() < 0.02 ? 0.5 + r() : 0;
    const cr = filt(crinkle, 'lowpass', 300);
    for (let i = 0; i < n; i++) x[i] *= (0.6 + cr[i] * 8) * Math.min(1, i / N(0.02)) * Math.exp(-i / (0.05 * SR));
    return norm(x, 0.2);
  }

  function thud() {
    const n = N(0.25);
    let x = mul(sine(lin(120, 60, n), n), decay(n, 0.05));
    x = add(x, mul(filt(noise(n, 81), 'lowpass', 1200), decay(n, 0.01)));
    return add(norm(x, 0.45), paper(9), 0.6);
  }

  function click() {
    const n = N(0.012);
    let x = mul(filt(noise(n, 21), 'highpass', 2000), decay(n, 0.002));
    x = add(x, mul(sine(2200, n), decay(n, 0.003)));
    return norm(x, 0.18);
  }

  const beep2 = (f1, d1, f2, d2, peak, dec) => {
    const a = square(f1, N(d1));
    let b = square(f2, N(d2));
    if (dec) b = mul(b, decay(b.length, dec));
    return norm(filt(fade(cat(a, b)), 'lowpass', 2500), peak);
  };

  function discrepancy() {
    const n1 = N(0.12), n2 = N(0.4);
    const a = mul(add(square(110, n1), square(155.6, n1)), 0.5);
    const b = mul(mul(add(square(98, n2), square(138.6, n2)), 0.5), decay(n2, 0.15));
    return norm(filt(fade(cat(a, b)), 'lowpass', 1400), 0.26);
  }

  function tray(reverse) {
    const n = N(0.26), m = N(0.09);
    const sweep = filt(noise(n, 31), 'bandpass', [300, 2400]);
    for (let i = 0; i < n; i++) sweep[i] *= Math.sin(Math.PI * i / n) * 0.7;
    let clunk = mul(add(sine(220, m), sine(331, m), 0.6), decay(m, 0.02));
    clunk = add(clunk, mul(filt(noise(m, 32), 'lowpass', 1500), decay(m, 0.01)));
    return norm(cat(sweep, clunk), reverse ? 0.18 : 0.26);
  }

  function stamp(kind) {
    const n = N(0.4);
    const f = kind === 'approve' ? lin(110, 50, n) : lin(95, 42, n);
    const th = mul(sine(f, n), decay(n, 0.09));
    const hit = mul(filt(noise(n, 41), 'lowpass', 1600), decay(n, 0.012));
    const chk = mul(filt(noise(n, 42), 'bandpass', [2000, 6000]), decay(n, 0.006));
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.tanh((th[i] + hit[i] * 0.8 + chk[i] * 0.4) * 1.5);
    return norm(x, 0.85);
  }

  function detainBtn() {
    const n = N(0.3);
    const gate = square(8, n);
    const x = mul(mul(square(220, n), gate.map((g) => (g > 0 ? 1 : 0))), decay(n, 0.2));
    return norm(filt(x, 'lowpass', 1800), 0.2);
  }

  function scuffle() {
    const out = new Float32Array(N(1.2)), r = rng(91);
    for (let i = 0; i < 10; i++) place(out, i * 0.1 + r() * 0.03, footstep(60 + (i % 6)), 0.8 + r() * 0.6);
    place(out, 0.35, mumble(0.35, 95, 92, 0.25));
    return out;
  }

  function printer(dur) {
    const n = N(dur), x = new Float32Array(n);
    const buzz = filt(square(55, n), 'lowpass', 900), tk = filt(noise(n, 71), 'bandpass', [1500, 5000]);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      x[i] = buzz[i] * (0.5 + 0.5 * Math.sign(Math.sin(2 * Math.PI * 14 * t))) * 0.6 +
        tk[i] * (Math.sin(2 * Math.PI * 28 * t) > 0.8 ? 0.5 : 0);
    }
    return norm(fade(x, 0.01, 0.05), 0.16);
  }

  function typekey(seed) {
    const n = N(0.03);
    return norm(mul(filt(noise(n, 300 + seed), 'bandpass', [1200, 5000]), decay(n, 0.004)), 0.12);
  }

  function whoosh() {
    const n = N(0.3), x = filt(noise(n, 88), 'bandpass', [400, 3000]);
    for (let i = 0; i < n; i++) x[i] *= Math.sin(Math.PI * i / n) ** 2;
    return norm(x, 0.2);
  }

  function crowdFight(dur) {
    const out = new Float32Array(N(dur)), r = rng(77);
    for (let i = 0; i < Math.floor(dur * 6); i++) place(out, r() * (dur - 0.3), mumble(0.25, 110 + r() * 110, 400 + i, 0.25));
    return norm(out, 0.3);
  }

  function bell() {
    const n = N(1.6);
    let x = new Float32Array(n);
    for (const [f, g] of [[880, 1], [1320, 0.5], [2200, 0.25]]) x = add(x, mul(sine(f, n), decay(n, 0.5)), g);
    return norm(x, 0.25);
  }

  function gunshot() {
    const n = N(0.5), sh = N(0.11);
    const crack = mul(filt(noise(n, 61), 'lowpass', 4000), decay(n, 0.02));
    const boom = mul(sine(lin(90, 40, n), n), decay(n, 0.12));
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.tanh((crack[i] + boom[i] + (i >= sh ? crack[i - sh] * 0.25 : 0)) * 2);
    return norm(x, 0.7);
  }

  function siren(dur) {
    const n = N(dur), f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = 620 + (Math.sin(2 * Math.PI * 0.9 * i / SR) > 0 ? 260 : 0);
    return norm(fade(filt(square(f, n, 0.4), 'lowpass', 2200), 0.05, 0.2), 0.16);
  }

  function glitch() {
    const n = N(0.6), x = new Float32Array(n), r = rng(55);
    for (let k = 0; k < 14; k++) {
      const p = Math.floor(r() * (n - 2000)), m = 400 + Math.floor(r() * 1600);
      const sq = square(200 + r() * 1800, m), g = 0.3 + r() * 0.7;
      for (let i = 0; i < m; i++) x[p + i] += sq[i] * g;
    }
    return norm(x, 0.25);
  }

  function xray() {
    const n = N(0.8), m = N(0.06);
    const a = sine(lin(80, 160, n), n), b = sine(lin(160, 320, n), n), beep = square(1320, m);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = (a[i] + 0.5 * b[i]) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 9 * i / SR)) + (i >= n - m ? beep[i - n + m] * 0.5 : 0);
    }
    return norm(fade(x, 0.05, 0.05), 0.18);
  }

  // ———————————————— 配乐（原创苏式小调进行曲） ————————————————

  const mf = (m) => 440 * 2 ** ((m - 69) / 12);
  const THEME = [
    [[62, 1], [62, .5], [64, .5], [65, 1], [69, 1]],
    [[67, 1.5], [65, .5], [64, 2]],
    [[60, 1], [64, .5], [65, .5], [67, 1], [70, 1]],
    [[69, 3], [null, 1]],
    [[74, 1], [72, .5], [70, .5], [69, 1], [65, 1]],
    [[67, 1], [70, .5], [69, .5], [67, 1], [64, 1]],
    [[65, 1], [64, .5], [62, .5], [61, 1], [64, 1]],
    [[62, 3], [null, 1]],
  ];
  const CHORDS = [[38, [62, 65, 69]], [36, [60, 64, 67]], [36, [60, 64, 70]], [41, [65, 69, 72]],
    [46, [62, 65, 70]], [43, [62, 67, 70]], [45, [61, 64, 69]], [38, [62, 65, 69]]];

  function lead(m, dur) {
    const n = N(dur), f = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / SR; f[i] = mf(m) * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.25)); }
    const a = square(f, n, 0.25), b = square(f.map((v) => v * 1.003), n), c = sine(f.map((v) => v / 2), n);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      x[i] = (a[i] * 0.6 + b[i] * 0.4 + c[i] * 0.3) * Math.min(1, t / 0.012) * (0.75 + 0.25 * Math.exp(-t / 0.08));
    }
    return filt(fade(x, 0.005, 0.05), 'lowpass', 2600);
  }

  const bass = (m, dur) => fade(mul(tri(mf(m), N(dur)), decay(N(dur), 0.35)), 0.004, 0.04);

  function pad(chord, dur) {
    const n = N(dur);
    let x = new Float32Array(n);
    for (const m of chord) x = add(x, square(mf(m - 12), n), 1 / chord.length);
    for (let i = 0; i < n; i++) x[i] *= Math.min(1, i / SR / 0.15);
    return filt(fade(x, 0.02, 0.2), 'lowpass', 900);
  }

  const kick = () => { const n = N(0.3); return mul(sine(lin(75, 45, n), n), decay(n, 0.09)); };
  const snare = (s) => { const n = N(0.14); return add(mul(filt(noise(n, 500 + s), 'bandpass', [1500, 6000]), decay(n, 0.04)), mul(sine(190, n), decay(n, 0.03)), 0.5); };

  function march(bars, bpm = 104, drums = true, leadG = 1, tail = 1.5) {
    const beat = 60 / bpm, bar = 4 * beat;
    const out = new Float32Array(N(bars.length * bar + tail));
    bars.forEach((b, bi) => {
      const t0 = bi * bar;
      let tt = t0;
      for (const [m, beats] of THEME[b]) {
        if (m) {
          const last = bi === bars.length - 1 && beats >= 3;
          place(out, tt, lead(m, beats * beat * (last ? 1.4 : 0.92)), 0.33 * leadG);
        }
        tt += beats * beat;
      }
      const [root, chord] = CHORDS[b];
      for (let k = 0; k < 4; k++) place(out, t0 + k * beat, bass(k % 2 === 0 ? root : root + 7, beat * 0.85), 0.3);
      place(out, t0, pad(chord, bar), 0.1);
      if (drums) {
        for (let k = 0; k < 4; k++) {
          if (k % 2 === 0) place(out, t0 + k * beat, kick(), 0.5);
          else place(out, t0 + k * beat, snare(k + bi), 0.22);
        }
        if (b === 3 || b === 7) for (let r = 0; r < 4; r++) place(out, t0 + 3 * beat + r * beat / 4, snare(20 + r), 0.12 + 0.03 * r);
      }
    });
    return norm(out, 0.6);
  }

  // A lighter continuous arrangement of the same original melody. Synthesize at
  // 16 kHz, then interpolate once, keeping the first interaction responsive.
  function backgroundMusic() {
    const rate = 16000, beat = 60 / 104, bar = beat * 4, duration = bar * THEME.length;
    const low = new Float32Array(Math.ceil(duration * rate) + 1);
    const note = (midi, start, dur, gain) => {
      const offset = Math.floor(start * rate), count = Math.floor(dur * rate);
      const attack = Math.min(count / 3, rate * 0.012), release = Math.min(count / 3, rate * 0.06);
      const increment = mf(midi) / rate;
      let ph = 0;
      for (let i = 0; i < count && offset + i < low.length; i++) {
        ph += increment; if (ph >= 1) ph -= 1;
        const wave = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
        const env = (i < attack ? i / attack : 1) * (i > count - release ? (count - i) / release : 1);
        low[offset + i] += wave * env * gain;
      }
    };
    THEME.forEach((melody, index) => {
      const start = index * bar, [root, chord] = CHORDS[index];
      let t = start;
      for (const [midi, beats] of melody) {
        if (midi) note(midi, t, beats * beat * 0.9, 0.25);
        t += beats * beat;
      }
      for (let k = 0; k < 4; k++) note(k % 2 ? root + 7 : root, start + k * beat, beat * 0.6, 0.15);
      for (const midi of chord) note(midi - 12, start, bar * 0.94, 0.035);
    });
    const edge = Math.floor(rate * 0.04);
    for (let i = 0; i < edge; i++) { low[i] *= i / edge; low[low.length - 1 - i] *= i / edge; }
    let peak = 0.001;
    for (const sample of low) { const value = sample < 0 ? -sample : sample; if (value > peak) peak = value; }
    const out = new Float32Array(N(duration)), ratio = rate / SR, gain = 0.5 / peak;
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio, index = pos | 0, frac = pos - index;
      out[i] = (low[index] + ((low[index + 1] || 0) - low[index]) * frac) * gain;
    }
    return out;
  }

  function dayHit() {
    const out = new Float32Array(N(1.6));
    for (let r = 0; r < 10; r++) place(out, r * 0.05, kick(), 0.15 + r * 0.03);
    place(out, 0.55, kick(), 1);
    place(out, 0.55, pad([62, 65, 69], 0.9), 0.35);
    return norm(out, 0.5);
  }

  // 全片唯一一次正经放行：D 大调号角
  function fanfare() {
    const beat = 0.5, out = new Float32Array(N(3.6));
    [[62, 0.5], [66, 0.5], [69, 0.5], [74, 2.5]].forEach(([m, b], i) => {
      place(out, i * 0.25, lead(m, b * beat), 0.4);
      place(out, i * 0.25, kick(), 0.4);
    });
    place(out, 0.75, pad([62, 66, 69, 74], 2.6), 0.18);
    place(out, 0.75, bass(38, 2.0), 0.4);
    return norm(out, 0.6);
  }

  // 低音嗡鸣 + 心跳
  function tension(dur) {
    const n = N(dur);
    const drone = filt(add(mul(square(mf(26), n), 0.5), square(mf(33) * 1.002, n), 0.4), 'lowpass', 300);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = drone[i] * Math.min(1, i / SR / 1.5) * 0.5;
    for (let k = 0; k < dur - 0.3; k += 0.8) { place(out, k, kick(), 0.6); place(out, k + 0.2, kick(), 0.4); }
    return norm(fade(out, 0.1, 0.4), 0.35);
  }

  const MAKERS = {
    gunshot, glitch, fanfare, xray,
    siren: () => siren(9), siren_short: () => siren(2.4), tension: () => tension(24),
    click, thud, intercom, discrepancy, scuffle, whoosh, bell, detain: detainBtn,
    inspect_on: () => beep2(330, 0.06, 495, 0.09, 0.13),
    inspect_off: () => beep2(495, 0.05, 330, 0.07, 0.09),
    select: () => norm(filt(fade(square(880, N(0.04))), 'lowpass', 3000), 0.1),
    citation: () => beep2(330, 0.15, 247, 0.3, 0.22, 0.12),
    tray: () => tray(false), tray_back: () => tray(true),
    stamp_deny: () => stamp('deny'), stamp_approve: () => stamp('approve'),
    title: () => march([0, 1, 2, 3]),
    end: () => march([4, 5, 6, 7]),
    music: backgroundMusic,
    sad: () => norm(march([6, 7], 84, false, 0.8, 2.0), 0.4),
    day_hit: dayHit,
    fight: () => crowdFight(3.0),
  };

  function buffer(name, make) {
    if (cache.has(name)) return cache.get(name);
    const data = make ? make() : MAKERS[name]();
    const b = ac.createBuffer(1, data.length, SR);
    b.copyToChannel(data, 0);
    cache.set(name, b);
    return b;
  }

  function playBuf(b, gain = 1, when = 0) {
    if (!ac || muted || paused) return null;
    const src = ac.createBufferSource();
    src.buffer = b;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(master);
    src.start(ac.currentTime + when);
    return src;
  }

  const musicLevel = () => musicScene === 'booth' ? 0.13 : ['summary', 'over'].includes(musicScene) ? 0.12 : 0.23;

  function resumeContext() {
    if (ac && !paused && ac.state !== 'running') {
      // Call during the first tap as well as later taps; iOS can report "interrupted".
      try { Promise.resolve(ac.resume()).catch(() => {}); } catch (e) { /* Retry on the next gesture. */ }
    }
  }

  function syncAmbient() {
    if (!ac) return;
    if (ambientWanted && !ambSrc) {
      ambSrc = ac.createBufferSource();
      ambSrc.buffer = buffer('ambient', ambient);
      ambSrc.loop = true;
      ambGain = ac.createGain();
      ambGain.gain.value = 0.8; // The master gain alone handles mute for every sound bus.
      ambSrc.connect(ambGain);
      ambGain.connect(master);
      ambSrc.start();
    } else if (!ambientWanted && ambSrc) {
      ambSrc.stop();
      ambSrc = null;
      ambGain = null;
    }
  }

  function syncMusic() {
    if (musicGain) musicGain.gain.value = musicLevel();
    if (!ac || musicSrc || musicQueued || paused || muted) return;
    musicQueued = true;
    // Let the first tap and its effect render before synthesizing the longer score.
    setTimeout(() => {
      musicQueued = false;
      if (!ac || musicSrc || paused || muted) return;
      musicSrc = ac.createBufferSource();
      musicSrc.buffer = buffer('music');
      musicSrc.loop = true;
      musicGain = ac.createGain();
      musicGain.gain.value = musicLevel();
      musicSrc.connect(musicGain);
      musicGain.connect(master);
      musicSrc.start();
    }, 0);
  }

  const api = {
    init() {
      if (ac) { resumeContext(); syncAmbient(); syncMusic(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      if (paused) Promise.resolve(ac.suspend()).catch(() => {});
      const comp = ac.createDynamicsCompressor();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(comp);
      comp.connect(ac.destination);
      resumeContext();
      syncAmbient();
      syncMusic();
      // 空闲时把常用音效先合成好，避免第一次播放卡顿
      const warm = ['click', 'select', 'stamp_deny', 'stamp_approve', 'tray', 'tray_back', 'discrepancy', 'inspect_on',
        'inspect_off', 'thud', 'intercom', 'citation', 'detain', 'scuffle', 'day_hit', 'whoosh', 'bell',
        'xray', 'gunshot'];
      let i = 0;
      const step = () => { if (i < warm.length) { buffer(warm[i++]); setTimeout(step, 30); } };
      setTimeout(step, 50);
    },
    play(name, gain = 1, when = 0) {
      if (!ac) return null;
      return playBuf(buffer(name), gain, when);
    },
    paper(seed = 0) { if (ac) playBuf(buffer('paper' + (seed % 8), () => paper(seed % 8))); },
    step(seed = 0) { if (ac) playBuf(buffer('step' + (seed % 6), () => footstep(60 + (seed % 6)))); },
    key(seed = 0) { if (ac) playBuf(buffer('key' + (seed % 16), () => typekey(seed % 16)), 1.5); },
    mumble(text, pitch, seed) {
      if (!ac) return;
      const dv = Math.round(Math.min(1.3, 0.25 + 0.065 * [...text].length) * 100) / 100;
      const key = `mum${dv}|${pitch}|${seed % 12}`;
      playBuf(buffer(key, () => mumble(dv, pitch, seed % 12)));
    },
    printer(dur) { if (ac) playBuf(buffer('printer' + dur, () => printer(dur))); },
    ambient(on) {
      ambientWanted = !!on;
      syncAmbient();
    },
    music(scene) { musicScene = scene; syncMusic(); },
    stop(src) { try { if (src) src.stop(); } catch (e) { /* 已经停了 */ } },
    setPaused(value) {
      paused = !!value;
      if (ac && paused) Promise.resolve(ac.suspend()).catch(() => {});
      else resumeContext();
      syncMusic();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.9;
      syncMusic();
      return muted;
    },
    get muted() { return muted; },
  };
  return api;
})();
