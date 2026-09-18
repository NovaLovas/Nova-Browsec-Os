/* clock.js — аналоговые + цифровые часы, секундомер, таймер. */

import registry from '../shell/registry.js';
import sound from '../services/sound.js';
import notify from '../services/notify.js';
import icon from '../ui/icons.js';
import { h, esc, fmtTime, fmtDate, dayName } from '../ui/dom.js';

function pad(n) { return String(n).padStart(2, '0'); }

function mount(root, win) {
  let tab = 'clock';

  root.innerHTML = `
    <div class="app">
      <div class="bar">
        <button class="side-i" data-tab="clock">${icon('clock')}<span>Часы</span></button>
        <button class="side-i" data-tab="stopwatch">${icon('gauge')}<span>Секундомер</span></button>
        <button class="side-i" data-tab="timer">${icon('history')}<span>Таймер</span></button>
      </div>
      <div class="ck" id="ck-body"></div>
    </div>`;

  const tabBtns = [...root.querySelectorAll('[data-tab]')];
  const body = root.querySelector('#ck-body');

  let tickTimer = null;
  let timers = [];

  function clearAll() {
    timers.forEach(clearInterval);
    timers = [];
  }

  function setTab(t) {
    tab = t;
    tabBtns.forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    clearAll();
    ({ clock: renderClock, stopwatch: renderStopwatch, timer: renderTimer })[t]();
  }
  tabBtns.forEach((b) => b.onclick = () => setTab(b.dataset.tab));

  /* ── часы ──────────────────────────────────────────────── */
  function renderClock() {
    body.innerHTML = `
      <div class="ck-face">
        <div class="ck-marks"></div>
        <div class="ck-hand h"></div>
        <div class="ck-hand m"></div>
        <div class="ck-hand s"></div>
        <div class="ck-pin"></div>
      </div>
      <div class="ck-digital">
        <div class="t">--:--:--</div>
        <div class="d">—</div>
      </div>
      <div class="ck-zones"></div>`;

    const face = body.querySelector('.ck-face');
    const marks = body.querySelector('.ck-marks');
    for (let i = 0; i < 60; i++) {
      const m = document.createElement('div');
      m.className = 'mk' + (i % 5 === 0 ? ' h5' : '');
      m.style.transform = `rotate(${i * 6}deg)`;
      marks.appendChild(m);
    }

    const hEl = body.querySelector('.ck-hand.h');
    const mEl = body.querySelector('.ck-hand.m');
    const sEl = body.querySelector('.ck-hand.s');
    const tEl = body.querySelector('.ck-digital .t');
    const dEl = body.querySelector('.ck-digital .d');
    const zones = body.querySelector('.ck-zones');

    const zoneList = ['UTC', 'Europe/Moscow', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
    zones.innerHTML = zoneList.map((z) => `
      <div class="ck-zone">
        <div class="zn">${esc(z.split('/').pop().replace(/_/g, ' '))}</div>
        <div class="zt" data-z="${esc(z)}">--:--</div>
      </div>`).join('');

    const tick = () => {
      const d = new Date();
      const h12 = d.getHours() % 12;
      const m = d.getMinutes();
      const s = d.getSeconds();
      const ms = d.getMilliseconds();

      hEl.style.transform = `rotate(${h12 * 30 + m * 0.5}deg)`;
      mEl.style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
      sEl.style.transform = `rotate(${s * 6 + ms * 0.006}deg)`;
      tEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      dEl.textContent = `${fmtDate(d)} · ${dayName(d)}`;

      zones.querySelectorAll('.zt').forEach((el) => {
        try {
          el.textContent = d.toLocaleTimeString('ru-RU', { timeZone: el.dataset.z, hour: '2-digit', minute: '2-digit' });
        } catch { el.textContent = '—'; }
      });
    };
    tick();
    timers.push(setInterval(tick, 120));
  }

  /* ── секундомер ────────────────────────────────────────── */
  function renderStopwatch() {
    body.innerHTML = `
      <div class="tmr">
        <div class="tmr-val">00:00.00</div>
        <div style="display:flex;gap:8px">
          <button class="btn primary" data-a="ss">${icon('play')}<span>Старт</span></button>
          <button class="btn" data-a="lap" disabled>${icon('plus')}<span>Круг</span></button>
          <button class="btn" data-a="reset" disabled>${icon('refresh')}<span>Сброс</span></button>
        </div>
        <div class="tmr-laps"></div>
      </div>`;

    let running = false, t0 = 0, acc = 0, laps = [];
    const val = body.querySelector('.tmr-val');
    const lapsEl = body.querySelector('.tmr-laps');
    const startBtn = body.querySelector('[data-a="ss"]');
    const lapBtn   = body.querySelector('[data-a="lap"]');
    const resetBtn = body.querySelector('[data-a="reset"]');

    const elapsed = () => acc + (running ? Date.now() - t0 : 0);
    const show = () => {
      const e = elapsed();
      const s = Math.floor(e / 1000);
      const cs = Math.floor((e % 1000) / 10);
      val.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${pad(cs)}`;
    };

    const tick = () => { if (running) { show(); requestAnimationFrame(tick); } };

    const renderLaps = () => {
      lapsEl.innerHTML = laps.map((l, i) => {
        const s = Math.floor(l / 1000);
        return `<div class="tmr-lap"><span>Круг ${i + 1}</span><span>${pad(Math.floor(s / 60))}:${pad(s % 60)}.${pad(Math.floor((l % 1000) / 10))}</span></div>`;
      }).join('');
    };

    startBtn.onclick = () => {
      running = !running;
      if (running) { t0 = Date.now(); tick(); }
      else { acc = elapsed(); }
      startBtn.innerHTML = running ? icon('pause') + '<span>Пауза</span>' : icon('play') + '<span>Старт</span>';
      lapBtn.disabled = !running;
      resetBtn.disabled = false;
      sound.click();
    };
    lapBtn.onclick = () => { laps.unshift(elapsed()); renderLaps(); sound.tick(); };
    resetBtn.onclick = () => {
      running = false; acc = 0; laps = [];
      val.textContent = '00:00.00';
      startBtn.innerHTML = icon('play') + '<span>Старт</span>';
      lapBtn.disabled = true; resetBtn.disabled = true;
      renderLaps();
      sound.click();
    };
  }

  /* ── таймер ────────────────────────────────────────────── */
  function renderTimer() {
    body.innerHTML = `
      <div class="tmr">
        <div class="tmr-val">00:00</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
          ${[1, 3, 5, 10, 15, 25, 45, 60].map((m) => `<button class="btn sm" data-min="${m}">${m} мин</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn primary" data-a="start">${icon('play')}<span>Запустить</span></button>
          <button class="btn" data-a="pause" disabled>${icon('pause')}<span>Пауза</span></button>
          <button class="btn" data-a="reset">${icon('refresh')}<span>Сброс</span></button>
        </div>
        <div class="dsc" style="font-size:12px;color:var(--fg-3);text-align:center">Выбери пресет или нажми «Своё», чтобы задать вручную</div>
      </div>`;

    let totalMs = 5 * 60 * 1000;
    let remainMs = totalMs;
    let deadline = 0;
    let running = false;
    let iv = null;

    const val = body.querySelector('.tmr-val');
    const startBtn = body.querySelector('[data-a="start"]');
    const pauseBtn = body.querySelector('[data-a="pause"]');

    const show = () => {
      const s = Math.max(0, Math.ceil(remainMs / 1000));
      val.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    };

    body.querySelectorAll('[data-min]').forEach((b) => {
      b.onclick = () => {
        running = false; clearInterval(iv);
        totalMs = remainMs = +b.dataset.min * 60000;
        show();
        pauseBtn.disabled = true;
        startBtn.disabled = false;
      };
    });

    startBtn.onclick = () => {
      if (running) return;
      running = true;
      deadline = Date.now() + remainMs;
      iv = setInterval(() => {
        remainMs = deadline - Date.now();
        if (remainMs <= 0) {
          remainMs = 0; running = false; clearInterval(iv);
          show();
          sound.error();
          notify.warn('Таймер сработал', `${totalMs / 60000} мин истекли`, { timeout: 0 });
          startBtn.disabled = false; pauseBtn.disabled = true;
          return;
        }
        show();
      }, 200);
      startBtn.disabled = true; pauseBtn.disabled = false;
    };
    pauseBtn.onclick = () => {
      running = false; clearInterval(iv);
      startBtn.disabled = false; pauseBtn.disabled = true;
    };
    body.querySelector('[data-a="reset"]').onclick = () => {
      running = false; clearInterval(iv);
      remainMs = totalMs;
      show();
      startBtn.disabled = false; pauseBtn.disabled = true;
    };

    show();
  }

  win.setTitle('Часы');
  setTab('clock');
  win.onCleanup(clearAll);
}

export default function register() {
  registry.register({
    id: 'clock', name: 'Часы', icon: 'clock',
    color: 'linear-gradient(135deg,#0891b2,#0e7490)',
    width: 480, height: 560, minWidth: 380, minHeight: 440,
    category: 'Утилиты', desc: 'Часы, мировые зоны, секундомер, таймер',
    keywords: ['время','clock','timer','stopwatch'],
    mount,
  });
}