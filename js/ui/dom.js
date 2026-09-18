/* dom.js — мелкие помощники UI: создание элементов, диалоги, контекстное меню, форматирование. */

import icon from './icons.js';
import sound from '../services/sound.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

/** Создать элемент из HTML-строки. */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Создать элемент из HTML-строки, вернуть все верхние узлы. */
export function hAll(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return [...t.content.children];
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── форматирование ───────────────────────────────────────── */
export function fmtSize(b) {
  if (b == null) return '—';
  if (b === 0) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  const v = b / Math.pow(1024, i);
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const DAYS_SHORT = ['вс','пн','вт','ср','чт','пт','сб'];

export const pad = (n) => String(n).padStart(2, '0');
export const fmtTime = (d = new Date(), sec = false) =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}${sec ? ':' + pad(d.getSeconds()) : ''}`;
export const fmtDate = (d = new Date()) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const fmtDateShort = (d = new Date()) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
export const fmtDateTime = (t) => { const d = new Date(t); return `${fmtDateShort(d)} ${fmtTime(d)}`; };
export const dayName = (d = new Date()) => DAYS[d.getDay()];
export const dayShort = (d = new Date()) => DAYS_SHORT[d.getDay()];
export const fmtWeekday = (d) => DAYS[d.getDay()];

export function fmtAgo(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 10) return 'только что';
  if (s < 60) return `${s} с назад`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr} ч назад`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d} дн назад`;
  return fmtDateShort(new Date(t));
}

export function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}

export const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

/* ── диалоги ──────────────────────────────────────────────── */
function modal(inner, { onMount } = {}) {
  const back = h(`<div class="modal" role="dialog" aria-modal="true"><div class="modal-box">${inner}</div></div>`);
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); back.dispatchEvent(new CustomEvent('cancel')); } };
  document.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) { close(); back.dispatchEvent(new CustomEvent('cancel')); } });
  onMount?.(back, close);
  return { back, close };
}

/** Подтверждение. Возвращает Promise<boolean>. */
export function confirm({ title, message, ok = 'Подтвердить', cancel = 'Отмена', danger = false }) {
  return new Promise((res) => {
    const { back, close } = modal(`
      <h3>${esc(title)}</h3>
      <div class="mb">${message}</div>
      <div class="mf">
        <button class="btn" data-a="no">${esc(cancel)}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button>
      </div>`);
    back.addEventListener('cancel', () => res(false));
    back.querySelector('[data-a="no"]').onclick = () => { close(); res(false); };
    const y = back.querySelector('[data-a="yes"]');
    y.onclick = () => { close(); res(true); };
    y.focus();
  });
}

/** Ввод строки. Возвращает Promise<string|null>. */
export function prompt({ title, message = '', value = '', placeholder = '', ok = 'ОК', validate = null }) {
  return new Promise((res) => {
    const { back, close } = modal(`
      <h3>${esc(title)}</h3>
      <div class="mb">${message}<input class="fld" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false"><div class="err" style="color:var(--danger);font-size:11.5px;margin-top:7px;min-height:15px"></div></div>
      <div class="mf">
        <button class="btn" data-a="no">Отмена</button>
        <button class="btn primary" data-a="yes">${esc(ok)}</button>
      </div>`);
    const inp = back.querySelector('input');
    const err = back.querySelector('.err');
    back.addEventListener('cancel', () => res(null));
    const submit = () => {
      const v = inp.value;
      if (validate) {
        const e = validate(v);
        if (e) { err.textContent = e; inp.focus(); return; }
      }
      close(); res(v);
    };
    back.querySelector('[data-a="no"]').onclick = () => { close(); res(null); };
    back.querySelector('[data-a="yes"]').onclick = submit;
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    inp.focus(); inp.select();
  });
}

/** Информационное окно. */
export function alert({ title, message, ok = 'Понятно' }) {
  return new Promise((res) => {
    const { back, close } = modal(`
      <h3>${esc(title)}</h3>
      <div class="mb">${message}</div>
      <div class="mf"><button class="btn primary">${esc(ok)}</button></div>`);
    back.addEventListener('cancel', () => res());
    const b = back.querySelector('button');
    b.onclick = () => { close(); res(); };
    b.focus();
  });
}

/* ── контекстное меню ─────────────────────────────────────── */
let ctxOpen = false;

/** items: [{label, icon, shortcut, danger, disabled, onClick} | 'sep'] */
export function contextMenu(x, y, items) {
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.innerHTML = items.map((it) => it === 'sep'
    ? '<div class="ctx-sep"></div>'
    : `<button class="ctx-item ${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>
         ${it.icon ? icon(it.icon) : '<span style="width:14px"></span>'}
         <span>${esc(it.label)}</span>
         ${it.shortcut ? `<span class="sc">${esc(it.shortcut)}</span>` : ''}
       </button>`).join('');

  const btns = [...menu.querySelectorAll('.ctx-item')];
  const acts = items.filter((i) => i !== 'sep');
  btns.forEach((b, i) => {
    if (acts[i].disabled) return;
    b.onclick = () => { closeContextMenu(); sound.click(); acts[i].onClick?.(); };
  });

  menu.classList.remove('hidden');
  const r = menu.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  menu.style.left = Math.min(x, vw - r.width - 8) + 'px';
  menu.style.top = Math.min(y, vh - r.height - 8) + 'px';
  ctxOpen = true;

  setTimeout(() => {
    const off = (e) => {
      if (menu.contains(e.target)) return;
      closeContextMenu(); document.removeEventListener('pointerdown', off);
    };
    document.addEventListener('pointerdown', off);
  }, 0);
}

export function closeContextMenu() {
  const m = document.getElementById('ctx-menu');
  if (m) { m.classList.add('hidden'); m.innerHTML = ''; }
  ctxOpen = false;
}
export const isContextMenuOpen = () => ctxOpen;

/** Пустое состояние с призывом к действию. */
export function emptyState({ icon: ic = 'info', title, text, action = null }) {
  const el = h(`
    <div class="empty">
      ${icon(ic, 'ill')}
      <h4>${esc(title)}</h4>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action ? `<button class="btn primary">${esc(action.label)}</button>` : ''}
    </div>`);
  if (action) el.querySelector('button').onclick = action.onClick;
  return el;
}
