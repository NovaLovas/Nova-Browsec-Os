/* notes.js — заметки: markdown, автосохранение в ФС, предпросмотр. */

import bus from '../kernel/bus.js';
import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import registry from '../shell/registry.js';
import icon from '../ui/icons.js';
import { h, esc, fmtAgo, prompt, confirm, emptyState } from '../ui/dom.js';
import md, { mdPlain } from '../ui/markdown.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';

const dirOf = () => fs.join(users.home(), 'Заметки');

function mount(root, win, args) {
  let notes = [];
  let cur = null;
  let mode = 'edit';       // edit | preview
  let saveTimer = null;

  root.innerHTML = `
    <div class="app-row">
      <div class="nt-list">
        <div class="bar" style="min-height:42px;padding:6px 8px">
          <button class="btn sm primary" data-a="new" style="flex:1">${icon('plus')}<span>Заметка</span></button>
        </div>
        <div class="nt-items"></div>
      </div>
      <div class="pane">
        <div class="bar">
          <input class="fld" data-a="title" placeholder="Заголовок" style="max-width:280px" aria-label="Заголовок заметки">
          <span class="grow"></span>
          <span class="saved" style="font-size:11px;color:var(--fg-3)"></span>
          <button class="btn sm" data-a="mode">${icon('eye')}<span>Просмотр</span></button>
          <button class="btn icon ghost" data-a="del" title="Удалить">${icon('trash')}</button>
        </div>
        <div class="editor-host" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
      </div>
    </div>`;

  const itemsEl = root.querySelector('.nt-items');
  const titleEl = root.querySelector('[data-a="title"]');
  const hostEl = root.querySelector('.editor-host');
  const savedEl = root.querySelector('.saved');
  const modeBtn = root.querySelector('[data-a="mode"]');

  async function loadAll() {
    await fs.mkdir(dirOf(), { recursive: true, quiet: true });
    let list = [];
    try { list = await fs.list(dirOf()); } catch { /* нет папки */ }
    const files = list.filter((n) => n.type === 'file' && fs.extname(n.path) === 'md');
    notes = [];
    for (const f of files) {
      const text = String(await fs.read(f.path).catch(() => ''));
      notes.push({ path: f.path, name: f.name.replace(/\.md$/, ''), text, modified: f.modified });
    }
    notes.sort((a, b) => b.modified - a.modified);
  }

  function renderList() {
    itemsEl.innerHTML = '';
    if (!notes.length) {
      itemsEl.appendChild(h(`<div style="padding:22px 14px;text-align:center;font-size:11.5px;color:var(--fg-3);line-height:1.6">Заметок пока нет.<br>Нажми «Заметка».</div>`));
      return;
    }
    for (const n of notes) {
      const b = h(`
        <button class="nt-item ${cur?.path === n.path ? 'on' : ''}">
          <div class="ti">${esc(n.name)}</div>
          <div class="pv">${esc(mdPlain(n.text).slice(0, 60) || 'пустая заметка')}</div>
          <div class="dt">${esc(fmtAgo(n.modified))}</div>
        </button>`);
      b.onclick = () => open(n);
      b.oncontextmenu = (e) => { e.preventDefault(); cur = n; del(); };
      itemsEl.appendChild(b);
    }
  }

  function renderBody() {
    hostEl.innerHTML = '';
    if (!cur) {
      hostEl.appendChild(emptyState({
        icon: 'notes', title: 'Выбери заметку',
        text: 'Слева список, кнопка «Заметка» создаёт новую. Поддерживается Markdown: заголовки, списки, код, таблицы.',
        action: { label: 'Создать заметку', onClick: create },
      }));
      return;
    }
    if (mode === 'preview') {
      const v = h(`<div class="md-view"></div>`);
      v.innerHTML = md(cur.text) || '<p style="color:var(--fg-3)">Пустая заметка. Переключись в правку и напиши что-нибудь.</p>';
      hostEl.appendChild(v);
      return;
    }
    const ta = h(`<textarea class="ed-area wrap" spellcheck="false" placeholder="# Заголовок

Пиши в Markdown. **Жирный**, *курсив*, \`код\`, - списки."></textarea>`);
    ta.value = cur.text;
    ta.oninput = () => { cur.text = ta.value; queueSave(); };
    ta.onkeydown = (e) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNow(); }
    };
    hostEl.appendChild(ta);
    setTimeout(() => ta.focus(), 40);
  }

  function open(n) {
    if (saveTimer) { clearTimeout(saveTimer); saveNow(); }
    cur = n;
    titleEl.value = n.name;
    win.setTitle(`${n.name} — Заметки`);
    savedEl.textContent = `сохранено ${fmtAgo(n.modified)}`;
    renderList(); renderBody();
  }

  function queueSave() {
    savedEl.textContent = 'печатаю…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }

  async function saveNow() {
    if (!cur) return;
    clearTimeout(saveTimer);
    try {
      await fs.write(cur.path, cur.text);
      cur.modified = Date.now();
      savedEl.textContent = 'сохранено';
      renderList();
    } catch (e) { savedEl.textContent = 'ошибка'; notify.error('Не удалось сохранить', e.message); }
  }

  async function create() {
    const base = 'Новая заметка';
    let name = base, i = 1;
    while (notes.some((n) => n.name === name)) name = `${base} ${++i}`;
    const path = fs.join(dirOf(), name + '.md');
    try {
      await fs.write(path, '');
      const n = { path, name, text: '', modified: Date.now() };
      notes.unshift(n);
      open(n);
      sound.success();
      titleEl.select();
    } catch (e) { notify.error('Не удалось создать', e.message); }
  }

  async function rename(newName) {
    if (!cur) return;
    const clean = newName.trim().replace(/[/\\]/g, '-');
    if (!clean || clean === cur.name) { titleEl.value = cur?.name || ''; return; }
    const np = fs.join(dirOf(), clean + '.md');
    if (await fs.exists(np)) { notify.warn('Такое имя занято', clean); titleEl.value = cur.name; return; }
    try {
      await fs.move(cur.path, np);
      cur.path = np; cur.name = clean;
      win.setTitle(`${clean} — Заметки`);
      renderList();
    } catch (e) { notify.error('Не удалось переименовать', e.message); titleEl.value = cur.name; }
  }

  async function del() {
    if (!cur) return;
    const ok = await confirm({ title: 'Удалить заметку?', message: `<b>${esc(cur.name)}</b> будет удалена.`, ok: 'Удалить', danger: true });
    if (!ok) return;
    try {
      await fs.remove(cur.path);
      notes = notes.filter((n) => n.path !== cur.path);
      cur = null;
      titleEl.value = '';
      win.setTitle('Заметки');
      renderList(); renderBody();
    } catch (e) { notify.error('Не удалось удалить', e.message); }
  }

  titleEl.onchange = () => rename(titleEl.value);
  titleEl.onkeydown = (e) => { if (e.key === 'Enter') titleEl.blur(); };
  root.querySelector('[data-a="new"]').onclick = create;
  root.querySelector('[data-a="del"]').onclick = del;
  modeBtn.onclick = () => {
    mode = mode === 'edit' ? 'preview' : 'edit';
    modeBtn.innerHTML = icon(mode === 'edit' ? 'eye' : 'edit') + `<span>${mode === 'edit' ? 'Просмотр' : 'Правка'}</span>`;
    renderBody();
  };

  win.onBeforeClose(async () => { if (cur) await saveNow(); return true; });
  win.onCleanup(() => clearTimeout(saveTimer));

  (async () => {
    await loadAll();
    renderList();
    if (args?.path) {
      const found = notes.find((n) => n.path === fs.norm(args.path));
      if (found) { open(found); return; }
      // markdown-файл вне папки заметок — откроем как есть
      try {
        const text = String(await fs.read(args.path));
        const n = { path: fs.norm(args.path), name: fs.basename(args.path).replace(/\.md$/, ''), text, modified: Date.now() };
        notes.unshift(n); open(n); return;
      } catch { /* не открылось — покажем список */ }
    }
    if (notes.length) open(notes[0]); else renderBody();
  })();

  const off = bus.on('fs:change', (e) => {
    if (e.path?.startsWith(dirOf()) && !e.path.includes(cur?.path || ' ')) loadAll().then(renderList);
  });
  win.onCleanup(off);
}

export default function register() {
  registry.register({
    id: 'notes', name: 'Заметки', icon: 'notes',
    color: 'linear-gradient(135deg,#10b981,#059669)',
    width: 820, height: 540, minWidth: 520, minHeight: 320,
    category: 'Работа', desc: 'Markdown-заметки с автосохранением',
    keywords: ['notes','markdown','записи','md'],
    mount,
  });
}
