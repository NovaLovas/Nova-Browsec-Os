/* files.js — файловый менеджер: навигация, два вида, операции, загрузка с диска. */

import bus from '../kernel/bus.js';
import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import { settings } from '../kernel/db.js';
import registry from '../shell/registry.js';
import { fileIcon } from '../shell/desktop.js';
import icon from '../ui/icons.js';
import { h, esc, fmtSize, fmtDateTime, contextMenu, prompt, confirm, emptyState, plural } from '../ui/dom.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';
import net from '../services/net.js';

const TEXT_EXT = ['txt','md','json','js','css','html','csv','log','sh','xml','yml','yaml','svg'];
const IMG_EXT = ['png','jpg','jpeg','gif','webp','svg','ico','bmp'];

export function openFile(node) {
  const e = fs.extname(node.path);
  if (IMG_EXT.includes(e) && e !== 'svg') registry.launch('viewer', { path: node.path });
  else if (e === 'md') registry.launch('notes', { path: node.path });
  else if (TEXT_EXT.includes(e) || !e) registry.launch('editor', { path: node.path });
  else {
    notify.warn('Нечем открыть', `Формат «${e || 'без расширения'}» система не умеет показывать. Сохрани файл на диск и открой в нужной программе.`, {
      actions: [{ label: 'Сохранить на диск', primary: true, onClick: async () => {
        const c = await fs.read(node.path, { asBlob: true });
        net.saveBlob(c, node.name, node.mime);
      } }],
    });
  }
}

function mount(root, win, args) {
  let cwd = args?.path || users.home();
  let view = settings.get('fmView', 'list');
  let sel = null;
  let clipboard = null;

  root.innerHTML = `
    <div class="app">
      <div class="bar">
        <button class="btn icon ghost" data-a="up" title="Вверх">${icon('chevronUp')}</button>
        <button class="btn icon ghost" data-a="home" title="Домой">${icon('home')}</button>
        <button class="btn icon ghost" data-a="refresh" title="Обновить">${icon('refresh')}</button>
        <div class="fm-crumbs"></div>
        <button class="btn icon ghost" data-a="newdir" title="Новая папка">${icon('folderPlus')}</button>
        <button class="btn icon ghost" data-a="newfile" title="Новый файл">${icon('filePlus')}</button>
        <button class="btn icon ghost" data-a="upload" title="Загрузить с диска">${icon('download')}</button>
        <button class="btn icon ghost" data-a="view" title="Вид"></button>
      </div>
      <div class="fm-body"></div>
      <div class="bar btm"><span class="status"></span><span class="grow"></span><span class="sel-info"></span></div>
    </div>
    <input type="file" multiple hidden>`;

  const crumbs = root.querySelector('.fm-crumbs');
  const body = root.querySelector('.fm-body');
  const status = root.querySelector('.status');
  const selInfo = root.querySelector('.sel-info');
  const fileInput = root.querySelector('input[type="file"]');
  const viewBtn = root.querySelector('[data-a="view"]');

  const go = async (p) => { cwd = fs.norm(p); sel = null; await render(); };

  function renderCrumbs() {
    const parts = cwd === '/' ? [] : cwd.slice(1).split('/');
    crumbs.innerHTML = '';
    const rootB = h(`<button class="fm-crumb ${!parts.length ? 'last' : ''}">/</button>`);
    rootB.onclick = () => go('/');
    crumbs.appendChild(rootB);
    let acc = '';
    parts.forEach((s, i) => {
      acc += '/' + s;
      const path = acc;
      crumbs.appendChild(h(`<span class="fm-sep">${icon('chevronRight')}</span>`));
      const b = h(`<button class="fm-crumb ${i === parts.length - 1 ? 'last' : ''}">${esc(s)}</button>`);
      b.onclick = () => go(path);
      crumbs.appendChild(b);
    });
    crumbs.scrollLeft = 9999;
  }

  async function render() {
    viewBtn.innerHTML = icon(view === 'list' ? 'grid' : 'list');
    renderCrumbs();
    win.setTitle(`Файлы — ${cwd === users.home() ? '~' : fs.basename(cwd)}`);

    let list;
    try { list = await fs.list(cwd); }
    catch (e) {
      body.innerHTML = '';
      body.appendChild(emptyState({
        icon: 'alert', title: 'Папка недоступна', text: e.message,
        action: { label: 'Домой', onClick: () => go(users.home()) },
      }));
      status.textContent = '';
      return;
    }

    const dirs = list.filter((n) => n.type === 'dir').length;
    status.textContent = `${list.length} ${plural(list.length, 'элемент', 'элемента', 'элементов')}` +
      (dirs ? ` · ${dirs} ${plural(dirs, 'папка', 'папки', 'папок')}` : '');
    selInfo.textContent = '';

    body.innerHTML = '';
    if (!list.length) {
      body.appendChild(emptyState({
        icon: 'folder', title: 'Здесь пусто',
        text: 'Создай папку или файл, либо перетащи файлы с рабочего стола системы прямо в это окно.',
        action: { label: 'Новая папка', onClick: () => create('dir') },
      }));
      return;
    }

    if (view === 'grid') {
      const grid = h('<div class="fm-grid"></div>');
      for (const n of list) {
        const t = h(`
          <button class="fm-tile" title="${esc(n.name)}">
            <span class="glyph ic-${kindOf(n)}">${icon(fileIcon(n))}</span>
            <span class="nm">${esc(n.name)}</span>
          </button>`);
        wire(t, n);
        grid.appendChild(t);
      }
      body.appendChild(grid);
    } else {
      const wrap = h(`
        <div class="fm-list">
          <div class="fm-lh"><span>Имя</span><span>Размер</span><span>Изменён</span><span>Права</span></div>
        </div>`);
      for (const n of list) {
        const r = h(`
          <button class="fm-row">
            <span class="nc"><span class="ic-${kindOf(n)}">${icon(fileIcon(n))}</span><span class="nm">${esc(n.name)}</span></span>
            <span class="sz">${n.type === 'dir' ? '—' : esc(fmtSize(n.size))}</span>
            <span class="dt">${esc(fmtDateTime(n.modified))}</span>
            <span class="pm">${esc(fs.modeStr(n))}</span>
          </button>`);
        wire(r, n);
        wrap.appendChild(r);
      }
      body.appendChild(wrap);
    }
  }

  const kindOf = (n) => {
    if (n.type === 'dir') return 'dir';
    const e = fs.extname(n.path);
    if (IMG_EXT.includes(e)) return 'img';
    if (['js','css','html','sh','py'].includes(e)) return 'code';
    if (e === 'md') return 'md';
    if (e === 'json') return 'json';
    if (e === 'app') return 'app';
    if (TEXT_EXT.includes(e)) return 'txt';
    return 'bin';
  };

  function wire(el, n) {
    el.addEventListener('click', () => {
      body.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      sel = n;
      selInfo.textContent = `${n.name} · ${n.type === 'dir' ? 'папка' : fmtSize(n.size)} · ${n.owner}:${n.group}`;
    });
    el.addEventListener('dblclick', () => (n.type === 'dir' ? go(n.path) : openFile(n)));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      sel = n;
      body.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      itemMenu(n, e.clientX, e.clientY);
    });
  }

  function itemMenu(n, x, y) {
    contextMenu(x, y, [
      { label: n.type === 'dir' ? 'Открыть' : 'Открыть', icon: 'external', onClick: () => (n.type === 'dir' ? go(n.path) : openFile(n)) },
      ...(n.type === 'file' ? [{ label: 'Открыть в редакторе', icon: 'edit', onClick: () => registry.launch('editor', { path: n.path }) }] : []),
      'sep',
      { label: 'Копировать', icon: 'copy', onClick: () => { clipboard = { op: 'copy', node: n }; notify.info('Скопировано', n.name, { timeout: 2000, silent: true }); } },
      { label: 'Вырезать', icon: 'box', onClick: () => { clipboard = { op: 'move', node: n }; notify.info('Вырезано', n.name, { timeout: 2000, silent: true }); } },
      { label: 'Вставить', icon: 'save', disabled: !clipboard, onClick: paste },
      'sep',
      { label: 'Переименовать', icon: 'edit', onClick: () => rename(n) },
      { label: 'Права доступа', icon: 'shield', onClick: () => chmod(n) },
      { label: 'Сохранить на диск', icon: 'download', onClick: () => saveToDisk(n) },
      { label: 'Копировать путь', icon: 'link', onClick: () => { navigator.clipboard?.writeText(n.path); notify.success('Путь скопирован', n.path, { timeout: 2000 }); } },
      'sep',
      { label: 'Удалить', icon: 'trash', danger: true, onClick: () => remove(n) },
    ]);
  }

  body.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.fm-row,.fm-tile')) return;
    e.preventDefault();
    contextMenu(e.clientX, e.clientY, [
      { label: 'Новая папка', icon: 'folderPlus', onClick: () => create('dir') },
      { label: 'Новый файл', icon: 'filePlus', onClick: () => create('file') },
      { label: 'Вставить', icon: 'save', disabled: !clipboard, onClick: paste },
      'sep',
      { label: 'Загрузить с диска', icon: 'download', onClick: () => fileInput.click() },
      { label: 'Обновить', icon: 'refresh', onClick: render },
      { label: view === 'list' ? 'Вид: сетка' : 'Вид: список', icon: view === 'list' ? 'grid' : 'list', onClick: toggleView },
    ]);
  });

  async function create(type) {
    const name = await prompt({
      title: type === 'dir' ? 'Новая папка' : 'Новый файл',
      value: type === 'dir' ? 'Новая папка' : 'файл.txt',
      validate: (v) => !v.trim() ? 'Введи имя' : v.includes('/') ? 'Имя не может содержать «/»' : null,
    });
    if (!name) return;
    try {
      const p = fs.join(cwd, name.trim());
      if (type === 'dir') await fs.mkdir(p);
      else await fs.write(p, '');
      sound.success();
      await render();
    } catch (e) { notify.error('Не удалось создать', e.message); }
  }

  async function rename(n) {
    const name = await prompt({
      title: 'Переименовать', value: n.name,
      validate: (v) => !v.trim() ? 'Имя не может быть пустым' : v.includes('/') ? 'Имя не может содержать «/»' : null,
    });
    if (!name || name === n.name) return;
    try { await fs.move(n.path, fs.join(fs.dirname(n.path), name.trim())); sound.success(); await render(); }
    catch (e) { notify.error('Не удалось переименовать', e.message); }
  }

  async function chmod(n) {
    const v = await prompt({
      title: 'Права доступа',
      message: `<b>${esc(n.name)}</b><br>Сейчас: <code>${fs.modeStr(n)}</code> (${(n.mode ?? 0).toString(8)})<br>Введи восьмеричные права, например 644 или 755.`,
      value: (n.mode ?? 0o644).toString(8),
      validate: (x) => /^[0-7]{3}$/.test(x) ? null : 'Нужны три цифры от 0 до 7',
    });
    if (!v) return;
    try { await fs.chmod(n.path, parseInt(v, 8)); sound.click(); await render(); }
    catch (e) { notify.error('Не удалось изменить права', e.message); }
  }

  async function remove(n) {
    const ok = await confirm({
      title: 'Удалить?', danger: true, ok: 'Удалить',
      message: `<b>${esc(n.name)}</b>${n.type === 'dir' ? ' и всё содержимое' : ''} будет удалён безвозвратно.`,
    });
    if (!ok) return;
    try { await fs.remove(n.path, { recursive: true }); sel = null; await render(); }
    catch (e) { notify.error('Не удалось удалить', e.message); }
  }

  async function paste() {
    if (!clipboard) return;
    const { op, node } = clipboard;
    let target = fs.join(cwd, node.name);
    let i = 1;
    while (await fs.exists(target)) {
      const base = node.name.replace(/(\.[^.]+)$/, '');
      const ext = node.name.slice(base.length);
      target = fs.join(cwd, `${base} (${++i})${ext}`);
    }
    try {
      op === 'copy' ? await fs.copy(node.path, target) : await fs.move(node.path, target);
      if (op === 'move') clipboard = null;
      sound.success();
      await render();
    } catch (e) { notify.error('Не удалось вставить', e.message); }
  }

  async function saveToDisk(n) {
    if (n.type === 'dir') { notify.warn('Только файлы', 'Папку целиком выгрузить нельзя — используй export в терминале.'); return; }
    const c = await fs.read(n.path, { asBlob: true });
    net.saveBlob(c instanceof Blob ? c : new Blob([c], { type: n.mime }), n.name, n.mime);
    notify.success('Файл сохранён', `${n.name} — проверь папку загрузок браузера`);
  }

  async function toggleView() {
    view = view === 'list' ? 'grid' : 'list';
    await settings.set('fmView', view);
    await render();
  }

  /* загрузка файлов с реального диска */
  fileInput.onchange = async () => {
    const files = [...fileInput.files];
    if (!files.length) return;
    let done = 0;
    for (const f of files) {
      try {
        const isText = f.type.startsWith('text/') || TEXT_EXT.includes(f.name.split('.').pop().toLowerCase());
        const content = isText ? await f.text() : f;
        await fs.write(fs.join(cwd, f.name), content, { mime: f.type || undefined });
        done++;
      } catch (e) { notify.error(`Не удалось: ${f.name}`, e.message); }
    }
    fileInput.value = '';
    if (done) { notify.success('Загружено', `${done} ${plural(done, 'файл', 'файла', 'файлов')} в ${cwd}`); sound.success(); }
    await render();
  };

  /* drag & drop с диска */
  const dz = root.querySelector('.app');
  const onOver = (e) => { e.preventDefault(); dz.style.outline = '2px dashed var(--accent)'; dz.style.outlineOffset = '-6px'; };
  const onLeave = () => { dz.style.outline = ''; };
  dz.addEventListener('dragover', onOver);
  dz.addEventListener('dragleave', onLeave);
  dz.addEventListener('drop', async (e) => {
    e.preventDefault(); onLeave();
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    for (const f of files) {
      const isText = f.type.startsWith('text/') || TEXT_EXT.includes(f.name.split('.').pop().toLowerCase());
      try { await fs.write(fs.join(cwd, f.name), isText ? await f.text() : f, { mime: f.type || undefined }); }
      catch (err) { notify.error(`Не удалось: ${f.name}`, err.message); }
    }
    notify.success('Готово', `Добавлено ${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}`);
    await render();
  });

  root.querySelector('[data-a="up"]').onclick = () => go(fs.dirname(cwd));
  root.querySelector('[data-a="home"]').onclick = () => go(users.home());
  root.querySelector('[data-a="refresh"]').onclick = render;
  root.querySelector('[data-a="newdir"]').onclick = () => create('dir');
  root.querySelector('[data-a="newfile"]').onclick = () => create('file');
  root.querySelector('[data-a="upload"]').onclick = () => fileInput.click();
  viewBtn.onclick = toggleView;

  const onKey = (e) => {
    if (!win.isFocused()) return;
    if (e.key === 'F5') { e.preventDefault(); render(); }
    else if (e.key === 'Delete' && sel) { e.preventDefault(); remove(sel); }
    else if (e.key === 'F2' && sel) { e.preventDefault(); rename(sel); }
    else if (e.key === 'Backspace' && !e.target.matches('input,textarea')) { e.preventDefault(); go(fs.dirname(cwd)); }
  };
  document.addEventListener('keydown', onKey);

  const offFs = bus.on('fs:change', (e) => {
    if (e.path?.startsWith(cwd) || e.to?.startsWith(cwd) || fs.dirname(e.path || '') === cwd) render();
  });
  win.onCleanup(() => { document.removeEventListener('keydown', onKey); offFs(); });

  render();
}

export default function register() {
  registry.register({
    id: 'files', name: 'Файлы', icon: 'folder',
    color: 'linear-gradient(135deg,#3b82f6,#2563eb)',
    width: 860, height: 540, minWidth: 520, minHeight: 320,
    category: 'Система', desc: 'Файловый менеджер: папки, права, загрузка с диска',
    keywords: ['проводник','explorer','папки','диск'],
    mount,
  });
}
