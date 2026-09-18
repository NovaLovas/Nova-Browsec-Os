/* taskmgr.js — диспетчер задач: процессы, окна, хранилище. */

import bus from '../kernel/bus.js';
import db from '../kernel/db.js';
import fs from '../kernel/fs.js';
import processes from '../kernel/processes.js';
import registry from '../shell/registry.js';
import wm from '../shell/wm.js';
import icon from '../ui/icons.js';
import { h, esc, fmtSize, fmtUptime, contextMenu, confirm, emptyState } from '../ui/dom.js';
import notify from '../services/notify.js';

const BOOT = Date.now();

function mount(root, win) {
  root.innerHTML = `
    <div class="app">
      <div class="tm-stats"></div>
      <div class="bar" style="min-height:38px">
        <span style="font-size:12px;font-weight:600">Процессы</span>
        <span class="grow"></span>
        <button class="btn sm" data-a="refresh">${icon('refresh')}<span>Обновить</span></button>
      </div>
      <div class="tm-table">
        <div class="tm-h"><span>PID</span><span>Приложение</span><span>Память</span><span>Время</span><span></span></div>
        <div class="rows"></div>
      </div>
    </div>`;

  const statsEl = root.querySelector('.tm-stats');
  const rowsEl = root.querySelector('.rows');

  async function renderStats() {
    const { usage, quota } = await db.usage();
    const files = await fs.all();
    const pct = quota ? Math.round((usage / quota) * 100) : 0;
    const mem = processes.totalMem();
    const cards = [
      { lb: 'Процессы', vl: processes.count(), bar: Math.min(100, processes.count() * 8) },
      { lb: 'Окна', vl: wm.count(), bar: Math.min(100, wm.count() * 12) },
      { lb: 'Память (оценка)', vl: mem + ' МБ', bar: Math.min(100, mem / 4) },
      { lb: 'Хранилище', vl: fmtSize(usage), bar: pct },
      { lb: 'Файлов в ФС', vl: files.length, bar: Math.min(100, files.length) },
      { lb: 'Время работы', vl: fmtUptime(Date.now() - BOOT), bar: null },
    ];
    statsEl.innerHTML = cards.map((c) => `
      <div class="tm-stat">
        <div class="lb">${esc(c.lb)}</div>
        <div class="vl">${esc(String(c.vl))}</div>
        ${c.bar != null ? `<div class="bar"><i style="width:${c.bar}%"></i></div>` : ''}
      </div>`).join('');
  }

  function renderRows() {
    const list = processes.list();
    rowsEl.innerHTML = '';
    if (!list.length) {
      rowsEl.appendChild(emptyState({ icon: 'activity', title: 'Нет процессов', text: 'Запусти приложение из меню «Пуск».' }));
      return;
    }
    for (const p of list) {
      const app = registry.get(p.appId);
      const w = p.winId != null ? wm.get(p.winId) : null;
      const r = h(`
        <div class="tm-r">
          <span class="pid">${p.pid}</span>
          <span class="nm">
            <span class="glyph" style="background:${app?.color || 'var(--accent)'}">${icon(app?.icon || 'window')}</span>
            <span>${esc(p.title)}</span>
            ${w?.minimized ? '<span class="tag">свёрнуто</span>' : ''}
          </span>
          <span class="mem">${p.mem} МБ</span>
          <span class="mem">${esc(fmtUptime(Date.now() - p.started))}</span>
          <span><button class="btn sm danger" style="height:22px;padding:0 8px">Снять</button></span>
        </div>`);
      r.querySelector('button').onclick = async () => {
        const ok = await confirm({
          title: 'Завершить процесс?', ok: 'Завершить', danger: true,
          message: `<b>${esc(p.title)}</b> (PID ${p.pid}). Несохранённые данные в этом окне будут потеряны.`,
        });
        if (!ok) return;
        processes.kill(p.pid, { force: true });
        notify.info('Процесс завершён', `${p.title} (PID ${p.pid})`, { timeout: 2500, silent: true });
      };
      r.oncontextmenu = (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Показать окно', icon: 'window', disabled: !w, onClick: () => p.winId != null && wm.focus(p.winId) },
          { label: 'Свернуть окно', icon: 'minus', disabled: !w, onClick: () => p.winId != null && wm.minimize(p.winId) },
          'sep',
          { label: 'Снять задачу', icon: 'x', danger: true, onClick: () => processes.kill(p.pid, { force: true }) },
        ]);
      };
      rowsEl.appendChild(r);
    }
  }

  const refresh = () => { renderStats(); renderRows(); };
  root.querySelector('[data-a="refresh"]').onclick = refresh;

  const timer = setInterval(refresh, 2000);
  const offs = ['proc:spawn','proc:kill','proc:update','win:open','win:close','win:minimize','win:restore']
    .map((e) => bus.on(e, refresh));
  win.onCleanup(() => { clearInterval(timer); offs.forEach((o) => o()); });

  refresh();
}

export default function register() {
  registry.register({
    id: 'taskmgr', name: 'Диспетчер задач', icon: 'activity',
    color: 'linear-gradient(135deg,#ef4444,#dc2626)',
    width: 720, height: 500, minWidth: 520, minHeight: 340,
    category: 'Система', desc: 'Процессы, память, хранилище',
    keywords: ['процессы','task','manager','монитор'],
    mount,
  });
}
