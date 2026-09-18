/* desktop.js — иконки рабочего стола, обои, контекстное меню стола. */

import bus from '../kernel/bus.js';
import fs from '../kernel/fs.js';
import { settings } from '../kernel/db.js';
import registry from './registry.js';
import wm from './wm.js';
import icon from '../ui/icons.js';
import { h, esc, contextMenu, prompt, confirm } from '../ui/dom.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';

export const WALLPAPERS = [
  { id: 'nebula', name: 'Небула' }, { id: 'aurora', name: 'Аврора' },
  { id: 'sunset', name: 'Закат' },  { id: 'rose',   name: 'Роза' },
  { id: 'mint',   name: 'Мята' },   { id: 'mono',   name: 'Графит' },
];

export const ACCENTS = [
  { id: 'indigo', c: '#6366f1', h: '#818cf8' }, { id: 'blue',   c: '#3b82f6', h: '#60a5fa' },
  { id: 'violet', c: '#8b5cf6', h: '#a78bfa' }, { id: 'pink',   c: '#ec4899', h: '#f472b6' },
  { id: 'green',  c: '#22c55e', h: '#4ade80' }, { id: 'amber',  c: '#f59e0b', h: '#fbbf24' },
  { id: 'teal',   c: '#14b8a6', h: '#2dd4bf' }, { id: 'red',    c: '#ef4444', h: '#f87171' },
];

const ICON_W = 96, ICON_H = 104;
let host = null;
let positions = {};

export const desktop = {
  async init() {
    host = document.getElementById('desktop-icons');
    positions = settings.get('iconPos', {}) || {};
    desktop.applyWallpaper(settings.get('wallpaper', 'nebula'));
    desktop.applyAccent(settings.get('accent', 'indigo'));
    await desktop.render();

    bus.on('app:register', () => desktop.render());
    bus.on('fs:change', (e) => { if (e.path?.startsWith(desktop.dir())) desktop.render(); });
    addEventListener('resize', () => desktop.render());

    const wall = document.getElementById('wallpaper');
    wall.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: 'Обновить', icon: 'refresh', onClick: () => desktop.render() },
        { label: 'Новая папка', icon: 'folderPlus', onClick: () => desktop.newItem('dir') },
        { label: 'Новый файл', icon: 'filePlus', onClick: () => desktop.newItem('file') },
        'sep',
        { label: 'Разложить окна плиткой', icon: 'grid', onClick: () => wm.tile() },
        { label: 'Свернуть все окна', icon: 'minus', onClick: () => wm.minimizeAll() },
        'sep',
        { label: 'Сменить обои', icon: 'image', onClick: () => registry.launch('settings', { tab: 'appearance' }) },
        { label: 'Настройки', icon: 'sliders', onClick: () => registry.launch('settings') },
      ]);
    });
    wall.addEventListener('pointerdown', () => {
      host.querySelectorAll('.d-icon.sel').forEach((n) => n.classList.remove('sel'));
    });
  },

  dir() {
    const u = fs.getUser().name;
    return u === 'root' ? '/root/Рабочий стол' : `/home/${u}/Рабочий стол`;
  },

  applyWallpaper(id) {
    const w = document.getElementById('wallpaper');
    w.className = '';
    if (id?.startsWith('custom:')) {
      w.style.backgroundImage = `url("${id.slice(7)}")`;
    } else {
      w.style.backgroundImage = '';
      w.classList.add('wp-' + (id || 'nebula'));
    }
  },

  applyAccent(id) {
    const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
    const r = document.documentElement.style;
    r.setProperty('--accent', a.c);
    r.setProperty('--accent-h', a.h);
    r.setProperty('--accent-soft', hexA(a.c, .15));
    r.setProperty('--accent-glow', hexA(a.c, .4));
  },

  applyTheme(mode) {
    const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  },

  async render() {
    if (!host) return;
    const apps = registry.onDesktop();
    let files = [];
    try { files = await fs.list(desktop.dir()); } catch { }

    const items = [
      ...apps.map((a) => ({ kind: 'app', key: 'app:' + a.id, name: a.name, icon: a.icon, color: a.color, app: a })),
      ...files.map((f) => ({ kind: 'file', key: 'file:' + f.path, name: f.name, node: f })),
    ];

    const H = host.clientHeight || 600;
    const perCol = Math.max(1, Math.floor(H / ICON_H));
    host.innerHTML = '';

    items.forEach((it, i) => {
      const pos = positions[it.key] || { x: Math.floor(i / perCol) * ICON_W, y: (i % perCol) * ICON_H };
      const node = h(`
        <div class="d-icon" style="left:${pos.x}px;top:${pos.y}px" tabindex="0" role="button">
          <div class="glyph" style="background:${it.kind === 'app' ? it.color : fileColor(it.node)}">
            ${icon(it.kind === 'app' ? it.icon : fileIcon(it.node))}
          </div>
          <div class="label">${esc(it.name)}</div>
        </div>`);
      node.dataset.key = it.key;

      const open = () => desktop.openItem(it);
      node.addEventListener('dblclick', open);
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      node.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        host.querySelectorAll('.d-icon.sel').forEach((n) => n.classList.remove('sel'));
        node.classList.add('sel');
        desktop.startDrag(node, it.key, e);
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        desktop.iconMenu(it, e.clientX, e.clientY);
      });
      host.appendChild(node);
    });
  },

  openItem(it) {
    if (it.kind === 'app') { registry.launch(it.app.id); return; }
    bus.emit('fs:open', { path: it.node.path, node: it.node });
  },

  iconMenu(it, x, y) {
    const items = it.kind === 'app'
      ? [
          { label: 'Открыть', icon: 'external', onClick: () => registry.launch(it.app.id) },
          'sep',
          { label: 'Убрать с рабочего стола', icon: 'eye', onClick: () => notify.info('Скрытие иконок', 'Управление иконками — в Настройки → Рабочий стол.') },
        ]
      : [
          { label: 'Открыть', icon: 'external', onClick: () => desktop.openItem(it) },
          { label: 'Открыть в Файлах', icon: 'folder', onClick: () => registry.launch('files', { path: fs.dirname(it.node.path) }) },
          'sep',
          { label: 'Переименовать', icon: 'edit', onClick: () => desktop.rename(it.node) },
          { label: 'Копировать путь', icon: 'copy', onClick: () => { navigator.clipboard?.writeText(it.node.path); notify.success('Путь скопирован', it.node.path); } },
          'sep',
          { label: 'Удалить', icon: 'trash', danger: true, onClick: () => desktop.remove(it.node) },
        ];
    contextMenu(x, y, items);
  },

  async rename(node) {
    const name = await prompt({
      title: 'Переименовать', value: node.name, placeholder: 'Новое имя',
      validate: (v) => !v.trim() ? 'Имя не может быть пустым' : v.includes('/') ? 'Имя не может содержать «/»' : null,
    });
    if (!name || name === node.name) return;
    try {
      await fs.move(node.path, fs.join(fs.dirname(node.path), name.trim()));
      sound.success();
    } catch (e) { notify.error('Не удалось переименовать', e.message); }
  },

  async remove(node) {
    const ok = await confirm({
      title: 'Удалить?', danger: true, ok: 'Удалить',
      message: `<b>${esc(node.name)}</b> будет удалён без возможности восстановления.`,
    });
    if (!ok) return;
    try { await fs.remove(node.path, { recursive: true }); sound.click(); }
    catch (e) { notify.error('Не удалось удалить', e.message); }
  },

  async newItem(type) {
    const name = await prompt({
      title: type === 'dir' ? 'Новая папка' : 'Новый файл',
      value: type === 'dir' ? 'Новая папка' : 'файл.txt',
      validate: (v) => !v.trim() ? 'Введи имя' : v.includes('/') ? 'Имя не может содержать «/»' : null,
    });
    if (!name) return;
    const p = fs.join(desktop.dir(), name.trim());
    try {
      await fs.mkdir(desktop.dir(), { recursive: true, quiet: true });
      if (type === 'dir') await fs.mkdir(p);
      else await fs.write(p, '');
      sound.success();
    } catch (e) { notify.error('Не удалось создать', e.message); }
  },

  startDrag(node, key, e) {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const x0 = parseInt(node.style.left) || 0, y0 = parseInt(node.style.top) || 0;
    let moved = false;
    const maxX = host.clientWidth - ICON_W + 8, maxY = host.clientHeight - ICON_H + 12;

    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      node.style.left = Math.max(0, Math.min(maxX, x0 + dx)) + 'px';
      node.style.top = Math.max(0, Math.min(maxY, y0 + dy)) + 'px';
    };
    const up = async () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (!moved) return;
      const gx = Math.round(parseInt(node.style.left) / ICON_W) * ICON_W;
      const gy = Math.round(parseInt(node.style.top) / ICON_H) * ICON_H;
      node.style.left = gx + 'px'; node.style.top = gy + 'px';
      positions[key] = { x: gx, y: gy };
      await settings.set('iconPos', positions);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  },

  async resetIcons() { positions = {}; await settings.set('iconPos', {}); desktop.render(); },
};

/* ── вспомогательное ──────────────────────────────────────── */
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function fileIcon(n) {
  if (!n) return 'file';
  if (n.type === 'dir') return 'folder';
  const e = fs.extname(n.path);
  if (['png','jpg','jpeg','gif','webp','svg','ico'].includes(e)) return 'image';
  if (['js','css','html','sh','py'].includes(e)) return 'code';
  if (e === 'md') return 'notes';
  if (e === 'json') return 'box';
  if (e === 'app') return 'puzzle';
  if (['txt','log','csv'].includes(e)) return 'fileText';
  return 'file';
}

export function fileColor(n) {
  if (!n) return 'linear-gradient(135deg,#64748b,#475569)';
  if (n.type === 'dir') return 'linear-gradient(135deg,#3b82f6,#2563eb)';
  const e = fs.extname(n.path);
  if (['png','jpg','jpeg','gif','webp','svg','ico'].includes(e)) return 'linear-gradient(135deg,#06b6d4,#0891b2)';
  if (['js','css','html','sh','py'].includes(e)) return 'linear-gradient(135deg,#f59e0b,#d97706)';
  if (e === 'md') return 'linear-gradient(135deg,#10b981,#059669)';
  if (e === 'json') return 'linear-gradient(135deg,#fbbf24,#f59e0b)';
  if (e === 'app') return 'linear-gradient(135deg,#a855f7,#7c3aed)';
  return 'linear-gradient(135deg,#64748b,#475569)';
}

export default desktop;