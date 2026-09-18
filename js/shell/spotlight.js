/* spotlight.js — быстрый поиск (Ctrl+Space): приложения, файлы, команды, вычисления. */

import bus from '../kernel/bus.js';
import fs from '../kernel/fs.js';
import registry from './registry.js';
import wm from './wm.js';
import icon from '../ui/icons.js';
import { h, esc, fmtSize } from '../ui/dom.js';
import { fileIcon, fileColor } from './desktop.js';
import { evalExpr } from '../apps/calculator.js';
import sound from '../services/sound.js';

let host = null, input = null, resultsEl = null;
let items = [];
let sel = 0;
let open = false;
let seq = 0;

/* Системные команды, доступные из поиска. */
const COMMANDS = [
  { id: 'lock',     name: 'Заблокировать систему', icon: 'lock',   kw: ['блок','lock'],       run: () => bus.emit('session:lock') },
  { id: 'shutdown', name: 'Завершить работу',      icon: 'power',  kw: ['выключ','shutdown'], run: () => bus.emit('session:shutdown') },
  { id: 'tile',     name: 'Разложить окна плиткой', icon: 'grid',  kw: ['плитк','tile','окна'], run: () => wm.tile() },
  { id: 'minall',   name: 'Свернуть все окна',     icon: 'minus',  kw: ['сверн','minimize'],  run: () => wm.minimizeAll() },
  { id: 'closeall', name: 'Закрыть все окна',      icon: 'x',      kw: ['закр','close'],      run: () => wm.closeAll() },
  { id: 'theme',    name: 'Переключить тему',      icon: 'moon',   kw: ['тем','theme','dark'],run: () => bus.emit('theme:toggle') },
];

export const spotlight = {
  init() {
    host = document.getElementById('spotlight');
    host.innerHTML = `
      <div class="sp-box" role="dialog" aria-label="Поиск">
        <div class="sp-input">
          ${icon('search')}
          <input placeholder="Приложения, файлы, команды, 2+2×3…" spellcheck="false" aria-label="Поисковый запрос">
          <kbd>ESC</kbd>
        </div>
        <div class="sp-results"></div>
      </div>`;
    input = host.querySelector('input');
    resultsEl = host.querySelector('.sp-results');

    input.oninput = () => spotlight.search(input.value);
    input.onkeydown = (e) => {
      if (e.key === 'Escape') { spotlight.close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); spotlight.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); spotlight.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); spotlight.run(items[sel]); }
      else if (e.key === 'Tab') { e.preventDefault(); spotlight.move(e.shiftKey ? -1 : 1); }
    };
    host.addEventListener('pointerdown', (e) => { if (e.target === host) spotlight.close(); });
    bus.on('spotlight:toggle', () => (open ? spotlight.close() : spotlight.open()));
    bus.on('spotlight:open', () => spotlight.open());
  },

  open() {
    open = true;
    host.classList.remove('hidden');
    input.value = '';
    input.focus();
    spotlight.search('');
    sound.click();
  },

  close() {
    open = false;
    host.classList.add('hidden');
    items = []; sel = 0;
  },

  isOpen() { return open; },

  async search(q) {
    const my = ++seq;
    const query = q.trim();
    const out = [];

    // 1. Математика — если строка похожа на выражение
    if (query && /[\d)]\s*[-+*/^%]|^[-+]?\s*\d|sqrt|sin|cos|tan|log|π|pi/i.test(query)) {
      try {
        const r = evalExpr(query);
        if (Number.isFinite(r)) {
          out.push({
            kind: 'calc', name: String(+r.toFixed(10)), sub: query, iconName: 'calculator',
            color: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', kindLabel: 'Вычисление',
            run: () => { navigator.clipboard?.writeText(String(+r.toFixed(10))); },
          });
        }
      } catch { /* не выражение — не беда */ }
    }

    // 2. Приложения
    for (const a of registry.search(query).slice(0, 8)) {
      out.push({
        kind: 'app', name: a.name, sub: a.desc || a.category, iconName: a.icon,
        color: a.color, kindLabel: 'Приложение', run: () => registry.launch(a.id),
      });
    }

    // 3. Команды
    if (query) {
      const ql = query.toLowerCase();
      for (const c of COMMANDS.filter((c) => c.name.toLowerCase().includes(ql) || c.kw.some((k) => k.startsWith(ql) || ql.startsWith(k)))) {
        out.push({
          kind: 'cmd', name: c.name, sub: 'Системная команда', iconName: c.icon,
          color: 'linear-gradient(135deg,#64748b,#475569)', kindLabel: 'Команда', run: c.run,
        });
      }
    }

    // 4. Файлы
    if (query.length >= 2) {
      try {
        const found = await fs.find(query, { limit: 10 });
        if (my !== seq) return;
        for (const n of found) {
          out.push({
            kind: 'file', name: n.name, sub: n.path, iconName: fileIcon(n), color: fileColor(n),
            kindLabel: n.type === 'dir' ? 'Папка' : fmtSize(n.size),
            run: () => (n.type === 'dir' ? registry.launch('files', { path: n.path }) : bus.emit('fs:open', { path: n.path, node: n })),
          });
        }
      } catch { /* ФС недоступна — пропускаем */ }
    }

    if (my !== seq) return;
    items = out;
    sel = 0;
    spotlight.render(query);
  },

  render(query) {
    resultsEl.innerHTML = '';
    if (!items.length) {
      resultsEl.appendChild(h(`
        <div class="empty" style="padding:34px 20px">
          ${icon(query ? 'search' : 'zap', 'ill')}
          <h4>${query ? 'Ничего не найдено' : 'Начни печатать'}</h4>
          <p>${query ? 'Попробуй другое слово или открой магазин приложений.' : 'Ищи приложения и файлы, считай выражения (12*7), выполняй команды.'}</p>
        </div>`));
      return;
    }

    let lastKind = null;
    const LABELS = { calc: 'Вычисление', app: 'Приложения', cmd: 'Команды', file: 'Файлы' };
    items.forEach((it, i) => {
      if (it.kind !== lastKind) {
        resultsEl.appendChild(h(`<div class="sp-sec">${LABELS[it.kind] || ''}</div>`));
        lastKind = it.kind;
      }
      const b = h(`
        <button class="sp-item ${i === sel ? 'sel' : ''}" data-i="${i}">
          <span class="glyph" style="background:${it.color}">${icon(it.iconName)}</span>
          <span class="meta"><span class="nm">${esc(it.name)}</span><span class="sub">${esc(it.sub || '')}</span></span>
          <span class="kind">${esc(it.kindLabel || '')}</span>
        </button>`);
      b.onclick = () => spotlight.run(it);
      b.onmouseenter = () => { sel = i; spotlight.highlight(); };
      resultsEl.appendChild(b);
    });
  },

  highlight() {
    resultsEl.querySelectorAll('.sp-item').forEach((b) => b.classList.toggle('sel', +b.dataset.i === sel));
    resultsEl.querySelector('.sp-item.sel')?.scrollIntoView({ block: 'nearest' });
  },

  move(d) {
    if (!items.length) return;
    sel = (sel + d + items.length) % items.length;
    spotlight.highlight();
  },

  run(it) {
    if (!it) return;
    spotlight.close();
    try { it.run(); } catch (e) { console.error('[spotlight]', e); }
  },
};

export default spotlight;
