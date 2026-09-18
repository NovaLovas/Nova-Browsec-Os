/* taskbar.js — панель задач, трей, меню «Пуск», быстрые настройки, центр уведомлений. */

import bus from '../kernel/bus.js';
import users from '../kernel/users.js';
import { settings } from '../kernel/db.js';
import registry from './registry.js';
import wm from './wm.js';
import desktop from './desktop.js';
import net from '../services/net.js';
import sound from '../services/sound.js';
import notify from '../services/notify.js';
import icon from '../ui/icons.js';
import { h, esc, fmtTime, fmtDateShort, fmtDate, dayName, fmtAgo, contextMenu, confirm } from '../ui/dom.js';

let el = {};
let openPop = null;

export const taskbar = {
  init() {
    el = {
      tasks: document.getElementById('tb-tasks'),
      start: document.getElementById('tb-start'),
      search: document.getElementById('tb-search'),
      clock: document.getElementById('tb-clock'),
      net: document.getElementById('tb-net'),
      vol: document.getElementById('tb-vol'),
      bell: document.getElementById('tb-bell'),
      startMenu: document.getElementById('start-menu'),
      qs: document.getElementById('quick-settings'),
      nc: document.getElementById('notif-center'),
    };

    el.start.innerHTML = icon('grid');
    el.search.innerHTML = icon('search');
    taskbar.renderTray();

    el.start.onclick = () => taskbar.toggle('start');
    el.search.onclick = () => bus.emit('spotlight:toggle');
    el.net.onclick = () => registry.launch('settings', { tab: 'network' });
    el.vol.onclick = () => taskbar.toggle('qs');
    el.bell.onclick = () => taskbar.toggle('nc');
    el.clock.onclick = () => taskbar.toggle('nc');

    el.clock.oncontextmenu = (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: 'Открыть Часы', icon: 'clock', onClick: () => registry.launch('clock') },
        { label: 'Настройки времени', icon: 'sliders', onClick: () => registry.launch('settings', { tab: 'system' }) },
      ]);
    };

    // клик вне панели закрывает всплывающие окна
    document.addEventListener('pointerdown', (e) => {
      if (!openPop) return;
      const pop = el[openPop === 'start' ? 'startMenu' : openPop];
      if (pop?.contains(e.target)) return;
      if (e.target.closest('#taskbar')) return;
      taskbar.closePop();
    });

    taskbar.tick();
    setInterval(taskbar.tick, 1000);

    ['win:open','win:close','win:focus','win:minimize','win:restore','win:update'].forEach((e) => bus.on(e, () => taskbar.renderTasks()));
    bus.on('notify:new', () => { taskbar.renderTray(); if (openPop === 'nc') taskbar.renderNC(); });
    bus.on('notify:change', () => { taskbar.renderTray(); if (openPop === 'nc') taskbar.renderNC(); });
    bus.on('net:status', () => taskbar.renderTray());
    bus.on('notify:dnd', () => taskbar.renderTray());
    taskbar.renderTasks();
  },

  tick() {
    const d = new Date();
    el.clock.querySelector('.t').textContent = fmtTime(d);
    el.clock.querySelector('.d').textContent = fmtDateShort(d);
  },

  renderTray() {
    const online = net.isOnline();
    el.net.innerHTML = icon(online ? 'wifi' : 'wifiOff');
    el.net.classList.toggle('on', online);
    el.net.title = online ? `Сеть доступна${net.proxy() ? ' · прокси включён' : ''}` : 'Нет подключения';

    el.vol.innerHTML = icon(sound.muted || sound.volume === 0 ? 'volumeOff' : 'volume');
    el.vol.title = sound.muted ? 'Звук выключен' : `Громкость ${Math.round(sound.volume * 100)}%`;

    const n = notify.count();
    el.bell.innerHTML = icon(notify.dnd ? 'bellOff' : 'bell') + (n ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : '');
    el.bell.title = notify.dnd ? 'Не беспокоить включено' : `Уведомлений: ${n}`;
  },

  renderTasks() {
    const list = wm.list();
    const focused = wm.focused();
    el.tasks.innerHTML = '';
    for (const w of list) {
      const app = registry.get(w.appId);
      const b = h(`
        <button class="tb-task ${focused?.id === w.id ? 'active' : ''}" title="${esc(w.title)}">
          <span class="ico" style="background:${w.color || app?.color || 'var(--accent)'}">${icon(w.iconName || app?.icon || 'window')}</span>
          <span class="tt">${esc(w.title)}</span>
        </button>`);
      b.onclick = () => {
        if (w.minimized) wm.restore(w.id);
        else if (focused?.id === w.id) wm.minimize(w.id);
        else wm.focus(w.id);
      };
      b.oncontextmenu = (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: w.minimized ? 'Развернуть' : 'Свернуть', icon: w.minimized ? 'arrowUp' : 'minus',
            onClick: () => (w.minimized ? wm.restore(w.id) : wm.minimize(w.id)) },
          { label: w.maximized ? 'Восстановить размер' : 'На весь экран', icon: 'maximize', onClick: () => wm.toggleMax(w.id) },
          'sep',
          { label: 'Новое окно', icon: 'plus', onClick: () => registry.launch(w.appId) },
          { label: 'Закрыть', icon: 'x', danger: true, onClick: () => wm.close(w.id) },
        ]);
      };
      el.tasks.appendChild(b);
    }
  },

  /* ── всплывающие панели ─────────────────────────────────── */
  toggle(which) {
    if (openPop === which) { taskbar.closePop(); return; }
    taskbar.closePop();
    openPop = which;
    if (which === 'start') taskbar.renderStart();
    if (which === 'qs') taskbar.renderQS();
    if (which === 'nc') taskbar.renderNC();
    const pop = el[which === 'start' ? 'startMenu' : which];
    pop.classList.remove('hidden');
    el.start.classList.toggle('on', which === 'start');
    sound.click();
  },

  closePop() {
    if (!openPop) return;
    const pop = el[openPop === 'start' ? 'startMenu' : openPop];
    pop?.classList.add('hidden');
    el.start.classList.remove('on');
    openPop = null;
  },

  isOpen() { return openPop; },

  renderStart(filter = '') {
    const u = users.current() || { label: 'Пользователь', name: 'user' };
    const apps = filter ? registry.search(filter) : registry.all();
    const cats = new Map();
    for (const a of apps) {
      if (!cats.has(a.category)) cats.set(a.category, []);
      cats.get(a.category).push(a);
    }

    el.startMenu.innerHTML = `
      <div class="sm-search"><input class="fld" placeholder="Найти приложение" value="${esc(filter)}" spellcheck="false" aria-label="Поиск приложений"></div>
      <div class="sm-body"></div>
      <div class="sm-foot">
        <button class="sm-user">
          <span class="av">${esc(u.label[0] || 'U')}</span>
          <span><span class="nm">${esc(u.label)}</span><br><span class="rl">${esc(u.name)}</span></span>
        </button>
        <button class="btn icon ghost" id="sm-lock" title="Заблокировать">${icon('lock')}</button>
        <button class="btn icon ghost" id="sm-power" title="Завершить работу">${icon('power')}</button>
      </div>`;

    const body = el.startMenu.querySelector('.sm-body');
    if (!apps.length) {
      body.innerHTML = `<div class="empty" style="padding:40px 20px">${icon('search','ill')}<h4>Ничего не найдено</h4><p>Проверь запрос или открой магазин приложений.</p></div>`;
    } else {
      for (const [cat, list] of [...cats].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
        body.appendChild(h(`<div class="sm-head">${esc(cat)}</div>`));
        const grid = h('<div class="sm-grid"></div>');
        for (const a of list) {
          const b = h(`
            <button class="sm-app" title="${esc(a.desc || a.name)}">
              <span class="glyph" style="background:${a.color}">${icon(a.icon)}</span>
              <span class="nm">${esc(a.name)}</span>
            </button>`);
          b.onclick = () => { taskbar.closePop(); registry.launch(a.id); };
          b.oncontextmenu = (e) => {
            e.preventDefault();
            contextMenu(e.clientX, e.clientY, [{ label: 'Открыть', icon: 'external', onClick: () => { taskbar.closePop(); registry.launch(a.id); } }]);
          };
          grid.appendChild(b);
        }
        body.appendChild(grid);
      }
    }

    const inp = el.startMenu.querySelector('input');
    inp.oninput = () => taskbar.renderStart(inp.value);
    inp.onkeydown = (e) => {
      if (e.key === 'Escape') { taskbar.closePop(); return; }
      if (e.key === 'Enter' && apps.length) { taskbar.closePop(); registry.launch(apps[0].id); }
    };
    if (filter) { inp.focus(); inp.setSelectionRange(filter.length, filter.length); } else inp.focus();

    el.startMenu.querySelector('.sm-user').onclick = () => { taskbar.closePop(); registry.launch('settings', { tab: 'users' }); };
    el.startMenu.querySelector('#sm-lock').onclick = () => { taskbar.closePop(); bus.emit('session:lock'); };
    el.startMenu.querySelector('#sm-power').onclick = async () => {
      taskbar.closePop();
      const ok = await confirm({ title: 'Завершить работу?', message: 'Все окна закроются. Данные в файловой системе сохранятся.', ok: 'Завершить', danger: true });
      if (ok) bus.emit('session:shutdown');
    };
  },

  renderQS() {
    const theme = settings.get('theme', 'dark');
    const online = net.isOnline();
    const vol = Math.round(sound.volume * 100);
    const bright = settings.get('brightness', 100);

    el.qs.innerHTML = `
      <div class="qs-grid">
        <button class="qs-tile ${online ? 'on' : ''}" data-a="net">
          <span class="ic">${icon(online ? 'wifi' : 'wifiOff')}</span>
          <span class="tx"><span class="nm">Сеть</span><span class="st">${online ? (net.proxy() ? 'Прокси включён' : 'Подключено') : 'Нет сети'}</span></span>
        </button>
        <button class="qs-tile ${notify.dnd ? 'on' : ''}" data-a="dnd">
          <span class="ic">${icon(notify.dnd ? 'bellOff' : 'bell')}</span>
          <span class="tx"><span class="nm">Не беспокоить</span><span class="st">${notify.dnd ? 'Включено' : 'Выключено'}</span></span>
        </button>
        <button class="qs-tile ${theme === 'dark' ? 'on' : ''}" data-a="theme">
          <span class="ic">${icon(theme === 'dark' ? 'moon' : 'sun')}</span>
          <span class="tx"><span class="nm">Тема</span><span class="st">${theme === 'dark' ? 'Тёмная' : theme === 'light' ? 'Светлая' : 'Авто'}</span></span>
        </button>
        <button class="qs-tile" data-a="tile">
          <span class="ic">${icon('grid')}</span>
          <span class="tx"><span class="nm">Плитка окон</span><span class="st">${wm.count()} ${wm.count() === 1 ? 'окно' : 'окон'}</span></span>
        </button>
      </div>
      <div class="qs-slider">
        ${icon(sound.muted ? 'volumeOff' : 'volume')}
        <input class="rng" type="range" min="0" max="100" value="${vol}" data-a="vol" aria-label="Громкость">
        <span class="val">${vol}%</span>
      </div>
      <div class="qs-slider">
        ${icon('sun')}
        <input class="rng" type="range" min="30" max="100" value="${bright}" data-a="bright" aria-label="Яркость">
        <span class="val">${bright}%</span>
      </div>
      <div class="qs-foot">
        <span class="info">${esc(fmtDate())}<br>${esc(dayName())}</span>
        <button class="btn icon ghost" data-a="settings" title="Все настройки">${icon('sliders')}</button>
        <button class="btn icon ghost" data-a="lock" title="Заблокировать">${icon('lock')}</button>
      </div>`;

    const act = {
      net: () => { taskbar.closePop(); registry.launch('settings', { tab: 'network' }); },
      dnd: async () => { await notify.setDnd(!notify.dnd); taskbar.renderQS(); taskbar.renderTray(); },
      theme: async () => {
        const order = ['dark', 'light', 'auto'];
        const next = order[(order.indexOf(theme) + 1) % 3];
        await settings.set('theme', next);
        desktop.applyTheme(next);
        taskbar.renderQS();
      },
      tile: () => { taskbar.closePop(); wm.tile(); },
      settings: () => { taskbar.closePop(); registry.launch('settings'); },
      lock: () => { taskbar.closePop(); bus.emit('session:lock'); },
    };
    el.qs.querySelectorAll('[data-a]').forEach((b) => {
      const a = b.dataset.a;
      if (b.tagName === 'INPUT') {
        b.oninput = async () => {
          const v = +b.value;
          b.parentElement.querySelector('.val').textContent = v + '%';
          if (a === 'vol') { await sound.setVolume(v / 100); if (sound.muted && v > 0) await sound.setMuted(false); taskbar.renderTray(); }
          else { await settings.set('brightness', v); taskbar.applyBrightness(v); }
        };
        return;
      }
      b.onclick = () => act[a]?.();
    });
  },

  applyBrightness(v) {
    const w = document.getElementById('wallpaper');
    const d = document.getElementById('desktop');
    if (!w || !d) return;
    d.style.filter = v >= 100 ? '' : `brightness(${Math.max(30, v) / 100})`;
  },

  renderNC() {
    const list = notify.list();
    el.nc.innerHTML = `
      <div class="nc-head">
        <h3>Уведомления</h3>
        <button class="btn sm ghost" data-a="dnd" title="Не беспокоить">${icon(notify.dnd ? 'bellOff' : 'bell')}</button>
        <button class="btn sm" data-a="clear" ${list.length ? '' : 'disabled'}>Очистить</button>
      </div>
      <div class="nc-body"></div>`;

    const body = el.nc.querySelector('.nc-body');
    if (!list.length) {
      body.appendChild(h(`<div class="empty" style="padding:44px 20px">${icon('bell','ill')}<h4>Тишина</h4><p>Здесь появятся системные сообщения: ошибки сети, завершённые загрузки, события приложений.</p></div>`));
    } else {
      for (const n of list) {
        const it = h(`
          <div class="nc-item">
            <div class="ic" style="background:${notify.colorOf(n.kind)}">${icon(notify.iconOf(n))}</div>
            <div class="bd">
              <div class="ti">${esc(n.title)}</div>
              ${n.message ? `<div class="ms">${esc(n.message)}</div>` : ''}
              <div class="tm">${esc(fmtAgo(n.at))}</div>
            </div>
            <button class="x" title="Убрать">${icon('x')}</button>
          </div>`);
        it.querySelector('.x').onclick = () => { notify.remove(n.id); taskbar.renderNC(); };
        body.appendChild(it);
      }
    }

    el.nc.querySelector('[data-a="clear"]').onclick = () => { notify.clear(); taskbar.renderNC(); };
    el.nc.querySelector('[data-a="dnd"]').onclick = async () => { await notify.setDnd(!notify.dnd); taskbar.renderNC(); taskbar.renderTray(); };
  },
};

export default taskbar;
