/* editor.js — текстовый редактор: открыть, править, сохранить в ФС. */

import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import registry from '../shell/registry.js';
import icon from '../ui/icons.js';
import { h, esc, prompt, confirm, fmtSize } from '../ui/dom.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';
import net from '../services/net.js';

function mount(root, win, args) {
  let path = args?.path || null;
  let dirty = false;
  let wrap = false;

  root.innerHTML = `
    <div class="app">
      <div class="bar">
        <button class="btn sm" data-a="open">${icon('folder')}<span>Открыть</span></button>
        <button class="btn sm primary" data-a="save">${icon('save')}<span>Сохранить</span></button>
        <button class="btn sm" data-a="saveas">Как…</button>
        <span class="ed-dirty hidden"></span>
        <span class="grow"></span>
        <button class="btn icon ghost" data-a="wrap" title="Перенос строк">${icon('type')}</button>
        <button class="btn icon ghost" data-a="disk" title="Сохранить на диск">${icon('download')}</button>
      </div>
      <div class="ed-wrap">
        <div class="ed-nums">1</div>
        <textarea class="ed-area" spellcheck="false" placeholder="Пустой буфер. Пиши здесь или открой файл кнопкой «Открыть»." aria-label="Текст файла"></textarea>
      </div>
      <div class="bar btm"><span class="pathv"></span><span class="grow"></span><span class="stats"></span></div>
    </div>`;

  const area = root.querySelector('.ed-area');
  const nums = root.querySelector('.ed-nums');
  const pathEl = root.querySelector('.pathv');
  const statsEl = root.querySelector('.stats');
  const dirtyEl = root.querySelector('.ed-dirty');

  const updateTitle = () => {
    const name = path ? fs.basename(path) : 'Без имени';
    win.setTitle(`${dirty ? '• ' : ''}${name} — Редактор`);
    pathEl.textContent = path || 'не сохранён';
    dirtyEl.classList.toggle('hidden', !dirty);
  };

  const updateStats = () => {
    const v = area.value;
    const lines = v ? v.split('\n').length : 1;
    const pos = v.slice(0, area.selectionStart).split('\n');
    statsEl.textContent = `${lines} стр · ${v.length} симв · ${fmtSize(new TextEncoder().encode(v).byteLength)} · ${pos.length}:${(pos[pos.length - 1] || '').length + 1}`;
    nums.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>');
  };

  const setDirty = (v) => { if (dirty !== v) { dirty = v; updateTitle(); } };

  async function load(p) {
    try {
      const c = await fs.read(p);
      if (c instanceof Blob) { notify.warn('Двоичный файл', 'Редактор открывает только текст.'); return false; }
      area.value = String(c);
      path = p;
      setDirty(false);
      updateTitle(); updateStats();
      area.scrollTop = 0;
      return true;
    } catch (e) { notify.error('Не удалось открыть', e.message); return false; }
  }

  async function save() {
    if (!path) return saveAs();
    try {
      await fs.write(path, area.value);
      setDirty(false);
      sound.success();
      notify.success('Сохранено', path, { timeout: 1800, silent: true });
      return true;
    } catch (e) { notify.error('Не удалось сохранить', e.message); return false; }
  }

  async function saveAs() {
    const p = await prompt({
      title: 'Сохранить как', value: path || fs.join(users.home(), 'новый.txt'),
      message: 'Полный путь в файловой системе:',
      validate: (v) => !v.trim() ? 'Введи путь' : null,
    });
    if (!p) return false;
    const full = fs.resolve(p.trim(), users.home());
    if (await fs.exists(full)) {
      const ok = await confirm({ title: 'Перезаписать?', message: `<code>${esc(full)}</code> уже существует.`, ok: 'Перезаписать', danger: true });
      if (!ok) return false;
    }
    try {
      await fs.write(full, area.value);
      path = full;
      setDirty(false); updateTitle();
      sound.success();
      notify.success('Сохранено', full, { timeout: 2000 });
      return true;
    } catch (e) { notify.error('Не удалось сохранить', e.message); return false; }
  }

  async function openDialog() {
    const p = await prompt({
      title: 'Открыть файл', value: path || users.home() + '/',
      message: 'Путь к файлу. Подсказка: в Файлах есть «Копировать путь».',
    });
    if (!p) return;
    if (dirty && !(await askSave())) return;
    await load(fs.resolve(p.trim(), users.home()));
  }

  async function askSave() {
    const r = await confirm({
      title: 'Есть несохранённые правки', ok: 'Сохранить', cancel: 'Отбросить',
      message: 'Сохранить изменения перед продолжением?',
    });
    if (r) return save();
    return true;
  }

  area.addEventListener('input', () => { setDirty(true); updateStats(); });
  area.addEventListener('keyup', updateStats);
  area.addEventListener('click', updateStats);
  area.addEventListener('scroll', () => { nums.scrollTop = area.scrollTop; });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = area.selectionStart, en = area.selectionEnd;
      area.setRangeText('  ', s, en, 'end');
      setDirty(true); updateStats();
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    if (e.key === 'o' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openDialog(); }
  });

  root.querySelector('[data-a="open"]').onclick = openDialog;
  root.querySelector('[data-a="save"]').onclick = save;
  root.querySelector('[data-a="saveas"]').onclick = saveAs;
  root.querySelector('[data-a="wrap"]').onclick = (e) => {
    wrap = !wrap;
    area.classList.toggle('wrap', wrap);
    e.currentTarget.classList.toggle('on', wrap);
  };
  root.querySelector('[data-a="disk"]').onclick = () => {
    net.saveBlob(area.value, path ? fs.basename(path) : 'текст.txt', 'text/plain;charset=utf-8');
    notify.success('Файл сохранён на диск', 'Проверь папку загрузок браузера');
  };

  win.onBeforeClose(async () => {
    if (!dirty) return true;
    const r = await confirm({
      title: 'Закрыть без сохранения?', ok: 'Сохранить и закрыть', cancel: 'Закрыть без сохранения',
      message: `Файл <b>${esc(path ? fs.basename(path) : 'Без имени')}</b> изменён.`,
    });
    if (r) return save();
    return true;
  });

  updateTitle(); updateStats();
  if (path) load(path);
  setTimeout(() => area.focus(), 60);
}

export default function register() {
  registry.register({
    id: 'editor', name: 'Редактор', icon: 'edit',
    color: 'linear-gradient(135deg,#f59e0b,#d97706)',
    width: 780, height: 520, minWidth: 420, minHeight: 260,
    category: 'Работа', desc: 'Текстовый редактор с номерами строк',
    keywords: ['текст','код','editor','правка'],
    mount,
  });
}
