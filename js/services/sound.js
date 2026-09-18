/* sound.js — все звуки синтезируются через Web Audio. Плотная атака, шумовые транзиенты. */

import { settings } from '../kernel/db.js';

let ctx = null;
let master = null;
let comp = null;
let volume = 0.65;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  // Лёгкая компрессия, чтобы не резало уши
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(ctx.destination);
  return ctx;
}

function resume() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  return c;
}

/** Тон с яркой атакой и опциональным шумовым транзиентом. */
function tone(freq, { type = 'sine', dur = 0.14, gain = 0.22, at = 0, slide = null, click = 0 } = {}) {
  const c = resume();
  if (!c || muted) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const t0 = c.currentTime + at;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(slide, 1), t0 + dur);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);

  if (click) transient(freq, click, at);
}

/** Короткий шумовой транзиент для «цифрового» щелчка. */
function transient(freq, amount = 0.5, at = 0) {
  const c = resume();
  if (!c || muted) return;
  const len = Math.floor(c.sampleRate * 0.008);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = Math.min(8000, freq * 2);
  f.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = amount * 0.08;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(c.currentTime + at);
}

function noise({ dur = 0.1, gain = 0.12, hp = 900, lp = null } = {}) {
  const c = resume();
  if (!c || muted) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = hp;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f);
  if (lp) {
    const f2 = c.createBiquadFilter();
    f2.type = 'lowpass'; f2.frequency.value = lp;
    f.connect(f2); f2.connect(g);
  } else {
    f.connect(g);
  }
  g.connect(master);
  src.start();
}

export const sound = {
  init() {
    volume = settings.get('volume', 0.65);
    muted = settings.get('muted', false);
    const unlock = () => {
      resume();
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  },

  get volume() { return volume; },
  get muted() { return muted; },
  ctx: () => ctx,
  master: () => master,

  async setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    if (master) master.gain.value = muted ? 0 : volume;
    await settings.set('volume', volume);
  },
  async setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : volume;
    await settings.set('muted', muted);
  },

  /* ── системные звуки ──────────────────────────────────── */
  click()   { tone(2100, { type: 'triangle', dur: 0.028, gain: 0.09, click: 0.6 }); },
  tick()    { tone(3200, { type: 'square',   dur: 0.012, gain: 0.05, click: 0.3 }); },
  key()     { noise({ dur: 0.02, gain: 0.05, hp: 2600 }); },

  open()    { tone(520, { type: 'triangle', dur: 0.09, gain: 0.14, slide: 880, click: 0.5 }); },
  close()   { tone(720, { type: 'triangle', dur: 0.09, gain: 0.12, slide: 320, click: 0.4 }); },
  snap()    { noise({ dur: 0.05, gain: 0.09, hp: 1400 }); tone(1800, { type: 'triangle', dur: 0.03, gain: 0.08, click: 0.4 }); },

  notify()  {
    tone(1100, { type: 'sine', dur: 0.11, gain: 0.18, click: 0.5 });
    tone(1650, { type: 'sine', dur: 0.15, gain: 0.14, at: 0.09, click: 0.3 });
  },
  success() {
    [660, 990, 1320].forEach((f, i) =>
      tone(f, { type: 'triangle', dur: 0.1, gain: 0.15, at: i * 0.06, click: 0.4 }));
  },
  error()   {
    [180, 130].forEach((f, i) =>
      tone(f, { type: 'sawtooth', dur: 0.14, gain: 0.14, at: i * 0.11, click: 0.2 }));
  },

  boot()    {
    [330, 440, 660, 990].forEach((f, i) =>
      tone(f, { type: 'triangle', dur: 0.55, gain: 0.13, at: i * 0.12, click: 0.3 }));
  },
  login()   {
    [520, 780, 1040].forEach((f, i) =>
      tone(f, { type: 'sine', dur: 0.28, gain: 0.14, at: i * 0.1, click: 0.4 }));
  },
  logout()  {
    [1040, 780, 520].forEach((f, i) =>
      tone(f, { type: 'sine', dur: 0.28, gain: 0.12, at: i * 0.1, click: 0.3 }));
  },

  shutter() {
    noise({ dur: 0.045, gain: 0.18, hp: 1900 });
    tone(1600, { type: 'triangle', dur: 0.03, gain: 0.09, at: 0.03, click: 0.6 });
  },

  /** Нота для музыкального приложения. */
  note(freq, dur = 0.4, type = 'triangle', gain = 0.16) {
    tone(freq, { type, dur, gain, click: 0.15 });
  },
};

export default sound;