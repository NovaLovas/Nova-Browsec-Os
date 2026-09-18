/* wm.js — оконный менеджер: создание, перетаскивание, ресайз, снап, фокус, z-order. */

import bus from '../kernel/bus.js';
import processes from '../kernel/processes.js';
import sound from '../services/sound.js';
import icon from '../ui/icons.js';

const wins = new Map();
let seq = 1;
let zTop = 10;
let layer = null;
let snapEl = null;
let cascade = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function bounds() {
  const r = layer.getBoundingClientRect();
  return { w: r.width, h: r.height };
}
/** Верхняя граница слоя окон в координатах экрана — для зоны снапа сверху. */
function layerTop() { return layer.getBoundingClientRect().top; }

export const wm = {
  init() {
    layer = document.getElementById('windows-layer');
    snapEl = document.getElementById('snap-preview');
    addEventListener('resize', () => {
      const { w, h } = bounds();
      for (const win of wins.values()) {
        if (win.maximized) { wm.applyGeom(win, { x: 0, y: 0, w, h }); continue; }
        win.geom.x = clamp(win.geom.x, -win.geom.w + 90, w - 90);
        win.geom.y = clamp(win.geom.y, 0, h - 40);
        wm.applyGeom(win, win.geom);
      }
    });
    // закрытие окна вместе с процессом
    bus.on('proc:kill', (p) => { if (p.winId != null) wm.close(p.winId, { silent: true }); });
  },

  /**
   * Открыть окно.
   * @param {object} o {title, appId, iconName, color, width, height, x, y, resizable, mount, pid}
   */
  open(o) {
    const { w: BW, h: BH } = bounds();
    const width = Math.min(o.width || 720, BW - 20);
    const height = Math.min(o.height || 480, BH - 20);
    const off = (cascade % 6) * 26;
    const x = o.x ?? clamp(Math.round((BW - width) / 2) + off - 60, 8, Math.max(8, BW - width - 8));
    const y = o.y ?? clamp(Math.round((BH - height) / 2) + off - 40, 8, Math.max(8, BH - height - 8));
    cascade++;

    const id = seq++;
    const node = document.createElement('div');
    node.className = 'win';
    node.dataset.id = id;
    node.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${++zTop}`;
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', o.title || 'Окно');
    node.innerHTML = `
      <div class="win-title">
        <div class="win-title-icon" style="background:${o.color || 'linear-gradient(135deg,#6366f1,#8b5cf6)'}">${icon(o.iconName || 'window')}</div>
        <div class="win-title-text">${esc(o.title || 'Окно')}</div>
        <div class="win-ctrls">
          <button class="win-ctrl min" title="Свернуть" aria-label="Свернуть">${icon('minus')}</button>
          <button class="win-ctrl max" title="Развернуть" aria-label="Развернуть">${icon('square')}</button>
          <button class="win-ctrl close" title="Закрыть" aria-label="Закрыть">${icon('x')}</button>
        </div>
      </div>
      <div class="win-body"></div>
      ${(o.resizable !== false) ? ['n','s','w','e','nw','ne','sw','se'].map((d) => `<div class="resize ${d}" data-dir="${d}"></div>`).join('') : ''}`;

    const win = {
      id, appId: o.appId, pid: o.pid ?? null, title: o.title || 'Окно',
      iconName: o.iconName || 'window', color: o.color, node,
      body: node.querySelector('.win-body'),
      geom: { x, y, w: width, h: height },
      pre: null, maximized: false, minimized: false,
      resizable: o.resizable !== false,
      minW: o.minWidth || 300, minH: o.minHeight || 180,
      onClose: o.onClose || null, cleanup: [],
    };
    wins.set(id, win);
    layer.appendChild(node);

    node.querySelector('.min').onclick = (e) => { e.stopPropagation(); wm.minimize(id); };
    node.querySelector('.max').onclick = (e) => { e.stopPropagation(); wm.toggleMax(id); };
    node.querySelector('.close').onclick = (e) => { e.stopPropagation(); wm.close(id); };
    node.addEventListener('pointerdown', () => wm.focus(id), true);

    const title = node.querySelector('.win-title');
    title.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win-ctrl')) return;
      wm.startDrag(win, e);
    });
    title.addEventListener('dblclick', (e) => { if (!e.target.closest('.win-ctrl')) wm.toggleMax(id); });
    node.querySelectorAll('.resize').forEach((h) => {
      h.addEventListener('pointerdown', (e) => wm.startResize(win, e, h.dataset.dir));
    });

    if (o.pid != null) processes.attachWindow(o.pid, id);
    wm.focus(id);
    sound.open();
    bus.emit('win:open', { id, appId: win.appId, title: win.title });

    // приложение получает контейнер и API окна
    if (typeof o.mount === 'function') {
      try {
        const api = wm.api(win);
        const r = o.mount(win.body, api);
        if (r && typeof r.then === 'function') r.catch((err) => wm.mountError(win, err));
      } catch (err) { wm.mountError(win, err); }
    }
    return wm.api(win);
  },

  mountError(win, err) {
    console.error(`[wm] ошибка запуска ${win.appId}:`, err);
    win.body.innerHTML = `
      <div class="empty">
        <div style="color:var(--danger)">${icon('alert', 'ill')}</div>
        <h4>Приложение не запустилось</h4>
        <p style="user-select:text">${esc(err?.message || String(err))}</p>
      </div>`;
  },

  /** Публичное API окна, которое получает приложение. */
  api(win) {
    return {
      id: win.id, pid: win.pid, body: win.body, node: win.node,
      setTitle: (t) => wm.setTitle(win.id, t),
      close: () => wm.close(win.id),
      focus: () => wm.focus(win.id),
      minimize: () => wm.minimize(win.id),
      maximize: () => wm.maximize(win.id),
      isFocused: () => win.node.classList.contains('focused'),
      resize: (w, h) => wm.applyGeom(win, { ...win.geom, w, h }),
      /** Зарегистрировать уборку — вызовется при закрытии окна. */
      onCleanup: (fn) => win.cleanup.push(fn),
      onBeforeClose: (fn) => { win.onClose = fn; },
    };
  },

  get(id) { return wins.get(id) || null; },
  list() { return [...wins.values()].map((w) => ({ id: w.id, appId: w.appId, pid: w.pid, title: w.title, iconName: w.iconName, color: w.color, minimized: w.minimized, maximized: w.maximized })); },
  count() { return wins.size; },
  focused() { const n = layer?.querySelector('.win.focused'); return n ? wins.get(+n.dataset.id) : null; },

  applyGeom(win, g) {
    win.geom = { ...g };
    win.node.style.left = g.x + 'px';
    win.node.style.top = g.y + 'px';
    win.node.style.width = g.w + 'px';
    win.node.style.height = g.h + 'px';
  },

  setTitle(id, t) {
    const w = wins.get(id);
    if (!w) return;
    w.title = t;
    w.node.querySelector('.win-title-text').textContent = t;
    w.node.setAttribute('aria-label', t);
    if (w.pid != null) processes.setTitle(w.pid, t);
    bus.emit('win:update', { id, title: t });
  },

  focus(id) {
    const w = wins.get(id);
    if (!w) return;
    if (w.minimized) { w.minimized = false; w.node.classList.remove('min'); w.node.style.display = ''; }
    for (const o of wins.values()) o.node.classList.toggle('focused', o.id === id);
    w.node.style.zIndex = ++zTop;
    bus.emit('win:focus', { id, appId: w.appId });
  },

  minimize(id) {
    const w = wins.get(id);
    if (!w || w.minimized) return;
    w.minimized = true;
    w.node.classList.add('min');
    w.node.classList.remove('focused');
    sound.close();
    setTimeout(() => { if (w.minimized) w.node.style.display = 'none'; }, 190);
    bus.emit('win:minimize', { id });
    // передать фокус верхнему видимому окну
    const rest = [...wins.values()].filter((o) => !o.minimized);
    if (rest.length) wm.focus(rest.reduce((a, b) => (+a.node.style.zIndex > +b.node.style.zIndex ? a : b)).id);
  },

  restore(id) {
    const w = wins.get(id);
    if (!w) return;
    w.minimized = false;
    w.node.style.display = '';
    w.node.classList.remove('min');
    wm.focus(id);
    bus.emit('win:restore', { id });
  },

  maximize(id) {
    const w = wins.get(id);
    if (!w || w.maximized) return;
    w.pre = { ...w.geom };
    w.maximized = true;
    w.node.classList.add('maximized');
    const { w: BW, h: BH } = bounds();
    wm.applyGeom(w, { x: 0, y: 0, w: BW, h: BH });
    w.node.querySelector('.max').innerHTML = icon('restore');
    bus.emit('win:maximize', { id });
  },

  unmaximize(id) {
    const w = wins.get(id);
    if (!w || !w.maximized) return;
    w.maximized = false;
    w.node.classList.remove('maximized');
    wm.applyGeom(w, w.pre || w.geom);
    w.node.querySelector('.max').innerHTML = icon('square');
    bus.emit('win:unmaximize', { id });
  },

  toggleMax(id) {
    const w = wins.get(id);
    if (!w) return;
    w.maximized ? wm.unmaximize(id) : wm.maximize(id);
    sound.snap();
  },

  async close(id, { silent = false } = {}) {
    const w = wins.get(id);
    if (!w) return;
    if (w.onClose) {
      try { if ((await w.onClose()) === false) return; }
      catch (e) { console.error('[wm] onBeforeClose:', e); }
    }
    for (const fn of w.cleanup) { try { fn(); } catch (e) { console.error('[wm] cleanup:', e); } }
    w.node.classList.add('closing');
    wins.delete(id);
    if (!silent) sound.close();
    setTimeout(() => w.node.remove(), 160);
    if (w.pid != null && processes.get(w.pid)) processes.kill(w.pid, { force: true });
    bus.emit('win:close', { id, appId: w.appId });
    const rest = [...wins.values()].filter((o) => !o.minimized);
    if (rest.length) wm.focus(rest.reduce((a, b) => (+a.node.style.zIndex > +b.node.style.zIndex ? a : b)).id);
  },

  closeAll() { for (const id of [...wins.keys()]) wm.close(id, { silent: true }); },

  /* ── перетаскивание ─────────────────────────────────────── */
  startDrag(win, e) {
    if (e.button !== 0) return;
    const { w: BW, h: BH } = bounds();
    const sx = e.clientX, sy = e.clientY;
    const g0 = { ...win.geom };
    const wasMax = win.maximized;
    let snapZone = null;
    win.node.classList.add('dragging');
    win.node.setPointerCapture?.(e.pointerId);

    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (wasMax && Math.hypot(dx, dy) > 8) {
        // отрываем развёрнутое окно — восстанавливаем размер под курсором
        wm.unmaximize(win.id);
        const pre = win.pre || g0;
        g0.w = pre.w; g0.h = pre.h;
        g0.x = ev.clientX - pre.w / 2; g0.y = Math.max(0, ev.clientY - 19);
        wm.applyGeom(win, { ...g0 });
        return;
      }
      wm.applyGeom(win, {
        ...win.geom,
        x: clamp(g0.x + dx, -g0.w + 90, BW - 90),
        y: clamp(g0.y + dy, 0, BH - 40),
      });
      // зоны снапа: края экрана
      const T = 14;
      let z = null;
      if (ev.clientY <= layerTop() + T) z = 'top';
      else if (ev.clientX <= 2 + T) z = 'left';
      else if (ev.clientX >= BW - T) z = 'right';
      if (z !== snapZone) { snapZone = z; wm.showSnap(z, BW, BH); }
    };

    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      win.node.classList.remove('dragging');
      wm.showSnap(null);
      if (snapZone) {
        win.pre = { ...g0 };
        const g = wm.snapGeom(snapZone, BW, BH);
        if (snapZone === 'top') wm.maximize(win.id);
        else wm.applyGeom(win, g);
        sound.snap();
      }
      bus.emit('win:moved', { id: win.id, geom: win.geom });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  },

  snapGeom(zone, BW, BH) {
    const half = Math.round(BW / 2);
    if (zone === 'left')  return { x: 0, y: 0, w: half, h: BH };
    if (zone === 'right') return { x: BW - half, y: 0, w: half, h: BH };
    return { x: 0, y: 0, w: BW, h: BH };
  },

  showSnap(zone, BW, BH) {
    if (!snapEl) return;
    if (!zone) { snapEl.style.opacity = '0'; return; }
    const g = wm.snapGeom(zone, BW, BH);
    snapEl.style.cssText = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;opacity:1`;
  },

  /* ── ресайз ─────────────────────────────────────────────── */
  startResize(win, e, dir) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (win.maximized) wm.unmaximize(win.id);
    const { w: BW, h: BH } = bounds();
    const sx = e.clientX, sy = e.clientY;
    const g0 = { ...win.geom };
    win.node.classList.add('resizing');

    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h } = g0;
      if (dir.includes('e')) w = clamp(g0.w + dx, win.minW, BW - g0.x);
      if (dir.includes('s')) h = clamp(g0.h + dy, win.minH, BH - g0.y);
      if (dir.includes('w')) {
        const nw = clamp(g0.w - dx, win.minW, g0.x + g0.w);
        x = g0.x + g0.w - nw; w = nw;
      }
      if (dir.includes('n')) {
        const nh = clamp(g0.h - dy, win.minH, g0.y + g0.h);
        y = g0.y + g0.h - nh; h = nh;
      }
      wm.applyGeom(win, { x, y, w, h });
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      win.node.classList.remove('resizing');
      bus.emit('win:resized', { id: win.id, geom: win.geom });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  },

  /** Разложить все видимые окна плиткой. */
  tile() {
    const vis = [...wins.values()].filter((w) => !w.minimized);
    if (!vis.length) return;
    const { w: BW, h: BH } = bounds();
    const cols = Math.ceil(Math.sqrt(vis.length));
    const rows = Math.ceil(vis.length / cols);
    const cw = Math.floor(BW / cols), ch = Math.floor(BH / rows);
    vis.forEach((w, i) => {
      if (w.maximized) wm.unmaximize(w.id);
      wm.applyGeom(w, { x: (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch });
    });
    sound.snap();
  },

  minimizeAll() { for (const w of wins.values()) if (!w.minimized) wm.minimize(w.id); },

  /** Переключение окон по Alt+Tab. */
  cycle(back = false) {
    const vis = [...wins.values()].filter((w) => !w.minimized)
      .sort((a, b) => +a.node.style.zIndex - +b.node.style.zIndex);
    if (vis.length < 2) { if (vis[0]) wm.focus(vis[0].id); return; }
    wm.focus(back ? vis[vis.length - 2].id : vis[0].id);
  },
};

export default wm;
