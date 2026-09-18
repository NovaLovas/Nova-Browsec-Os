/* music.js — музыкальный плеер на Web Audio. Треки синтезируются в реальном времени. */

import registry from '../shell/registry.js';
import sound from '../services/sound.js';
import notify from '../services/notify.js';
import icon from '../ui/icons.js';
import { h, esc } from '../ui/dom.js';

/* Короткие «треки» — каждая нота играется, пока идёт время.
   Формат: { name, artist, dur, bpm, scale: [частоты], wave, pattern } */
const TRACKS = [
  {
    name: 'Nebula Drift', artist: 'OS Synth', dur: 42, bpm: 96, wave: 'triangle',
    scale: [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33],
    pattern: [0,2,4,5,4,2,0,3,5,7,6,4,2,1,0,4],
  },
  {
    name: 'Aurora Line', artist: 'OS Synth', dur: 36, bpm: 78, wave: 'sine',
    scale: [196, 233.08, 261.63, 311.13, 349.23, 392, 466.16, 523.25],
    pattern: [0,1,2,3,2,1,0,4,5,6,5,4,3,2,1,0],
  },
  {
    name: 'Mono Graphite', artist: 'OS Synth', dur: 48, bpm: 110, wave: 'sawtooth',
    scale: [130.81, 155.56, 174.61, 196, 233.08, 261.63, 293.66, 349.23],
    pattern: [0,3,4,7,4,3,0,5,2,6,4,7,6,5,3,0],
  },
  {
    name: 'Mint Breeze', artist: 'OS Synth', dur: 40, bpm: 84, wave: 'triangle',
    scale: [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25],
    pattern: [0,2,4,7,5,3,1,2,4,6,7,5,3,1,2,0],
  },
  {
    name: 'Deep Focus', artist: 'OS Synth', dur: 60, bpm: 70, wave: 'sine',
    scale: [110, 130.81, 146.83, 174.61, 196, 220, 261.63, 293.66],
    pattern: [0,0,2,4,4,2,0,3,5,5,7,6,4,2,0,0],
  },
];

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function mount(root, win) {
  let idx = 0;
  let playing = false;
  let elapsed = 0;
  let timer = null;
  let stepTimer = null;
  let bars = 28;
  let barHeights = new Array(bars).fill(3);

  root.innerHTML = `
    <div class="mu">
      <div class="mu-vis"></div>
      <div class="mu-info">
        <div class="ti">—</div>
        <div class="ar">—</div>
      </div>
      <div class="mu-ctl">
        <button class="mu-b" data-a="prev" title="Назад">${icon('prev')}</button>
        <button class="mu-b play" data-a="play" title="Играть">${icon('play')}</button>
        <button class="mu-b" data-a="next" title="Вперёд">${icon('next')}</button>
      </div>
      <div style="padding:0 18px 12px">
        <input class="rng" type="range" min="0" max="100" value="0" data-a="seek" aria-label="Позиция">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--fg-3);margin-top:4px">
          <span class="t-cur">0:00</span>
          <span class="t-dur">0:00</span>
        </div>
      </div>
      <div class="mu-tracks"></div>
    </div>`;

  const visEl   = root.querySelector('.mu-vis');
  const tiEl    = root.querySelector('.mu-info .ti');
  const arEl    = root.querySelector('.mu-info .ar');
  const playBtn = root.querySelector('[data-a="play"]');
  const seekEl  = root.querySelector('[data-a="seek"]');
  const tCur    = root.querySelector('.t-cur');
  const tDur    = root.querySelector('.t-dur');
  const tracksEl= root.querySelector('.mu-tracks');

  for (let i = 0; i < bars; i++) {
    const b = document.createElement('i');
    b.style.height = '3px';
    visEl.appendChild(b);
  }
  const barEls = [...visEl.children];

  function renderTracks() {
    tracksEl.innerHTML = '';
    TRACKS.forEach((t, i) => {
      const row = h(`
        <button class="mu-tr ${i === idx ? 'on' : ''}" data-i="${i}">
          <span class="n">${i + 1}</span>
          <span class="mt">
            <span class="ti">${esc(t.name)}</span>
            <span class="ar">${esc(t.artist)}</span>
          </span>
          <span class="dr">${fmt(t.dur)}</span>
        </button>`);
      row.onclick = () => { idx = i; stop(); loadTrack(); play(); };
      tracksEl.appendChild(row);
    });
  }

  function loadTrack() {
    const t = TRACKS[idx];
    tiEl.textContent = t.name;
    arEl.textContent = t.artist;
    tDur.textContent = fmt(t.dur);
    tCur.textContent = '0:00';
    seekEl.value = '0';
    win.setTitle(`${t.name} — Музыка`);
    renderTracks();
  }

  function setBar(i, h) {
    barHeights[i] = h;
    barEls[i].style.height = Math.max(3, h) + 'px';
  }

  function noiseBar() {
    for (let i = 0; i < bars; i++) {
      const fade = 1 - i / bars * 0.55;
      setBar(i, (Math.random() * 62 + 8) * fade);
    }
  }

  function flattenBars() {
    for (let i = 0; i < bars; i++) setBar(i, 3);
  }

  function play() {
    if (playing) return;
    const t = TRACKS[idx];
    if (elapsed >= t.dur) elapsed = 0;
    playing = true;
    playBtn.innerHTML = icon('pause');

    const beatMs = 60000 / t.bpm / 2;
    const totalBeats = Math.floor(t.dur * 1000 / beatMs);
    let beat = Math.floor(elapsed * 1000 / beatMs);

    stepTimer = setInterval(() => {
      const pattern = t.pattern[beat % t.pattern.length];
      const base = t.scale[pattern % t.scale.length];
      const octave = beat % 8 < 4 ? 1 : 2;
      sound.note(base * octave, beatMs / 1000 * 0.9, t.wave, 0.12);
      noiseBar();
      beat++;
    }, beatMs);

    const startAt = Date.now() - elapsed * 1000;
    timer = setInterval(() => {
      elapsed = (Date.now() - startAt) / 1000;
      if (elapsed >= t.dur || beat > totalBeats) { next(); return; }
      tCur.textContent = fmt(elapsed);
      seekEl.value = String(Math.min(100, elapsed / t.dur * 100));
    }, 220);
  }

  function stop() {
    playing = false;
    playBtn.innerHTML = icon('play');
    clearInterval(timer);
    clearInterval(stepTimer);
    timer = stepTimer = null;
    flattenBars();
  }

  function toggle() { playing ? stop() : play(); }

  function next() {
    const wasPlaying = playing;
    stop();
    idx = (idx + 1) % TRACKS.length;
    elapsed = 0;
    loadTrack();
    if (wasPlaying) play();
  }
  function prev() {
    const wasPlaying = playing;
    stop();
    idx = (idx - 1 + TRACKS.length) % TRACKS.length;
    elapsed = 0;
    loadTrack();
    if (wasPlaying) play();
  }

  playBtn.onclick = toggle;
  root.querySelector('[data-a="next"]').onclick = next;
  root.querySelector('[data-a="prev"]').onclick = prev;

  seekEl.oninput = () => {
    const t = TRACKS[idx];
    elapsed = t.dur * (+seekEl.value / 100);
    tCur.textContent = fmt(elapsed);
    if (playing) { stop(); play(); }
  };

  win.onCleanup(() => { stop(); clearInterval(timer); clearInterval(stepTimer); });

  loadTrack();
  renderTracks();
}

export default function register() {
  registry.register({
    id: 'music', name: 'Музыка', icon: 'music',
    color: 'linear-gradient(135deg,#a855f7,#ec4899)',
    width: 520, height: 620, minWidth: 380, minHeight: 460,
    category: 'Медиа', desc: 'Синтезатор на Web Audio — треки генерируются в реальном времени',
    keywords: ['музыка','плеер','audio','synth'],
    mount,
  });
}