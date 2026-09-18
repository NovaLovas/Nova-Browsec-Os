/* notify.js — тосты + центр уведомлений. DND уважается. */

import bus from '../kernel/bus.js';
import { settings } from '../kernel/db.js';
import sound from './sound.js';
import icon from '../ui/icons.js';

const items = [];       // история (новые в начале)
let seq = 1;
let dnd = false;
const MAX = 60;

const COLORS = {
  info:    'linear-gradient(135deg,#6366f1,#8b5cf6)',
  success: 'linear-gradient(135deg,#22c55e,#16a34a)',
  warn:    'linear-gradient(135deg,#f59e0b,#d97706)',
  error:   'linear-gradient(135deg,#ef4444,#dc2626)',
};
const ICONS = { info: 'info', success: 'check', warn: 'alert', error: 'alert' };

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function renderToast(n) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = el(`
    <div class="toast" role="status" data-id="${n.id}">
      <div class="ic" style="background:${COLORS[n.kind] || COLORS.info}">${icon(n.icon || ICONS[n.kind] || 'info')}</div>
      <div class="bd">
        <div class="ti">${esc(n.title)}</div>
        ${n.message ? `<div class="ms">${esc(n.message)}</div>` : ''}
        ${n.actions?.length ? '<div class="act"></div>' : ''}
      </div>
    </div>`);

  if (n.actions?.length) {
    const box = t.querySelector('.act');
    n.actions.forEach((a) => {
      const b = el(`<button class="btn sm ${a.primary ? 'primary' : ''}">${esc(a.label)}</button>`);
      b.onclick = (e) => { e.stopPropagation(); try { a.onClick?.(); } finally { dismiss(t); } };
      box.appendChild(b);
    });
  }
  t.addEventListener('click', () => dismiss(t));
  host.appendChild(t);

  const ttl = n.timeout ?? (n.kind === 'error' ? 8000 : 5000);
  if (ttl > 0) setTimeout(() => dismiss(t), ttl);
}

function dismiss(t) {
  if (!t || t.classList.contains('out')) return;
  t.classList.add('out');
  setTimeout(() => t.remove(), 200);
}

export const notify = {
  init() {
    dnd = settings.get('dnd', false);
    bus.on('net:popup-blocked', (url) => notify.push({
      kind: 'warn', title: 'Всплывающее окно заблокировано',
      message: 'Браузер не дал открыть новую вкладку. Разреши popup для этого сайта.',
      actions: [{ label: 'Скопировать ссылку', onClick: () => navigator.clipboard?.writeText(url) }],
    }));
  },

  get dnd() { return dnd; },
  async setDnd(v) { dnd = !!v; await settings.set('dnd', dnd); bus.emit('notify:dnd', dnd); },

  /** Показать уведомление. kind: info|success|warn|error */
  push({ kind = 'info', title, message = '', icon: ic = null, actions = null, timeout, silent = false, toast = true } = {}) {
    const n = { id: seq++, kind, title, message, icon: ic, actions, timeout, at: Date.now() };
    items.unshift(n);
    if (items.length > MAX) items.length = MAX;
    bus.emit('notify:new', n);
    if (!dnd) {
      if (toast) renderToast(n);
      if (!silent) kind === 'error' ? sound.error() : sound.notify();
    }
    return n.id;
  },

  info:    (title, message, o = {}) => notify.push({ ...o, kind: 'info', title, message }),
  success: (title, message, o = {}) => notify.push({ ...o, kind: 'success', title, message }),
  warn:    (title, message, o = {}) => notify.push({ ...o, kind: 'warn', title, message }),
  error:   (title, message, o = {}) => notify.push({ ...o, kind: 'error', title, message }),

  list() { return [...items]; },
  count() { return items.length; },
  remove(id) {
    const i = items.findIndex((n) => n.id === id);
    if (i >= 0) { items.splice(i, 1); bus.emit('notify:change'); }
  },
  clear() { items.length = 0; bus.emit('notify:change'); },

  colorOf: (kind) => COLORS[kind] || COLORS.info,
  iconOf: (n) => n.icon || ICONS[n.kind] || 'info',
};

export default notify;
