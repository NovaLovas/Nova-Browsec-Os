/* os.js — точка входа Browsec OS. */

import bus from './kernel/bus.js';
import db, { settings } from './kernel/db.js';
import fs from './kernel/fs.js';
import users from './kernel/users.js';
import processes from './kernel/processes.js';
import registry from './shell/registry.js';
import wm from './shell/wm.js';
import desktop from './shell/desktop.js';
import taskbar from './shell/taskbar.js';
import spotlight from './shell/spotlight.js';
import net from './services/net.js';
import sound from './services/sound.js';
import notify from './services/notify.js';
import clipboard, { installClipboardHooks } from './services/clipboard.js';
import icon from './ui/icons.js';
import { h, esc, fmtTime, fmtDate, dayName } from './ui/dom.js';

/* приложения */
import registerBrowser    from './apps/browser.js';
import registerCalculator from './apps/calculator.js';
import registerEditor     from './apps/editor.js';
import registerFiles      from './apps/files.js';
import registerNotes      from './apps/notes.js';
import registerSettings   from './apps/settings-app.js';
import registerTaskmgr    from './apps/taskmgr.js';
import registerTerminal   from './apps/terminal.js';
import registerStore, { loadInstalledApps } from './apps/store.js';
import registerWeather    from './apps/weather.js';
import registerMusic      from './apps/music.js';
import registerPaint      from './apps/paint.js';
import registerClock      from './apps/clock.js';
import registerViewer     from './apps/viewer.js';
import registerCamera     from './apps/camera.js';

const $ = (s) => document.querySelector(s);
const boot       = $('#boot');
const bootBar    = $('#boot-bar i');
const bootStatus = $('#boot-status');
const bootErr    = $('#boot-err');
const lock       = $('#lock');
const desktopEl  = $('#desktop');

const BOOT_TIME = Date.now();
let lockTimer = null;
let pendingUser = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(p, txt) {
  bootBar.style.width = p + '%';
  bootStatus.textContent = txt;
  await sleep(70);
}

function fatal(err) {
  console.error('[boot]', err);
  bootBar.style.background = 'var(--danger)';
  bootErr.classList.remove('hidden');
  bootErr.innerHTML =
    `<b>Система не запустилась</b><br>${esc(err?.message || String(err))}` +
    (location.protocol === 'file:'
      ? '<br><br>Ты открыл файл напрямую. Запусти <code>python -m http.server</code> и открой <code>http://localhost:8000</code>.'
      : '');
}

function registerApps() {
  const list = [
    ['Браузер',     registerBrowser],
    ['Калькулятор', registerCalculator],
    ['Редактор',    registerEditor],
    ['Файлы',       registerFiles],
    ['Заметки',     registerNotes],
    ['Настройки',   registerSettings],
    ['Диспетчер',   registerTaskmgr],
    ['Терминал',    registerTerminal],
    ['Магазин',     registerStore],
    ['Погода',      registerWeather],
    ['Музыка',      registerMusic],
    ['Paint',       registerPaint],
    ['Часы',        registerClock],
    ['Просмотр',    registerViewer],
    ['Камера',      registerCamera],
  ];
  for (const [name, fn] of list) {
    try { fn(); }
    catch (e) { console.error(`[app] ${name} не зарегистрировано:`, e); }
  }
}

async function ensureFs() {
  for (const p of ['/home', '/root', '/tmp', '/etc', '/etc/apps', '/usr']) {
    await fs.mkdir(p, { recursive: true, quiet: true });
  }
  for (const u of users.all()) {
    const home = users.home(u.name);
    await fs.mkdir(home, { recursive: true, quiet: true });
    for (const d of ['Документы', 'Загрузки', 'Изображения', 'Рабочий стол', 'Заметки']) {
      await fs.mkdir(fs.join(home, d), { recursive: true, quiet: true });
    }
    const readme = fs.join(home, 'Документы', 'Добро пожаловать.md');
    if (!(await fs.exists(readme))) {
      await fs.write(readme, [
        '# Добро пожаловать в Browsec OS',
        '',
        'Это изолированная система. Всё хранится в IndexedDB браузера — реальный диск не затрагивается.',
        '',
        '## Что попробовать',
        '- **Магазин** — установи приложения внутрь ОС',
        '- **Терминал** — команды `ls`, `help`, `ping`',
        '- **Заметки** — Markdown с автосохранением',
        '- **Настройки → Сеть** — прокси для чтения любых сайтов',
        '',
        '## Горячие клавиши',
        '- `Win` — меню «Пуск»',
        '- `Ctrl+Space` — поиск',
        '- `Alt+Tab` — переключение окон',
        '- `Ctrl+Alt+L` — блокировка',
      ].join('\n'));
    }
  }
}

async function bootSequence() {
  try {
    await step(8,  'инициализация хранилища');
    await db.ready();

    await step(18, 'загрузка настроек');
    await settings.load();

    await step(26, 'звуковая подсистема');
    sound.init();

    await step(34, 'пользователи');
    await users.init();

    await step(42, 'сеть');
    net.init();

    await step(52, 'файловая система');
    await ensureFs();

    await step(60, 'буфер обмена');
    await clipboard.init();
    installClipboardHooks();

    await step(68, 'уведомления');
    notify.init();

    await step(76, 'базовые приложения');
    registerApps();

    await step(84, 'установленные приложения');
    await loadInstalledApps();

    await step(92, 'оболочка');
    await initShell();

    await step(100, 'готово');
    await sleep(320);

    boot.classList.add('out');
    setTimeout(() => boot.classList.add('hidden'), 500);

    showLock();
    sound.boot();
  } catch (e) {
    fatal(e);
  }
}

async function initShell() {
  wm.init();
  taskbar.init();
  spotlight.init();
  desktop.applyTheme(settings.get('theme', 'dark'));
  await desktop.init();
  taskbar.applyBrightness(settings.get('brightness', 100));

  if (!settings.get('bootTime')) await settings.set('bootTime', BOOT_TIME);
}

/* ── Экран блокировки ─────────────────────────────────────── */
function renderLock() {
  const clockEl = lock.querySelector('.lock-clock .time');
  const dateEl  = lock.querySelector('.lock-clock .date');
  const tick = () => {
    const d = new Date();
    clockEl.textContent = fmtTime(d);
    dateEl.textContent = `${fmtDate(d)} · ${dayName(d)}`;
  };
  tick();
  if (lockTimer) clearInterval(lockTimer);
  lockTimer = setInterval(tick, 1000);

  const usersBox = lock.querySelector('.users');
  usersBox.innerHTML = '';
  usersBox.classList.remove('hidden');
  for (const u of users.all()) {
    const b = h(`
      <button class="user-btn" data-u="${esc(u.name)}">
        <div class="user-avatar">${esc((u.label[0] || 'U').toUpperCase())}</div>
        <div class="user-name">${esc(u.label)}</div>
        <div class="user-role">${esc(u.role)}</div>
      </button>`);
    b.onclick = () => selectUser(u);
    usersBox.appendChild(b);
  }

  const pwd = lock.querySelector('.pwd');
  pwd.classList.add('hidden');
  pwd.querySelector('input').value = '';
  pwd.querySelector('.pwd-hint').textContent = '';
  pwd.querySelector('.pwd-hint').classList.remove('err');
  lock.querySelector('.lock-back').classList.add('hidden');
}

function selectUser(u) {
  pendingUser = u;
  const usersBox = lock.querySelector('.users');
  const pwd = lock.querySelector('.pwd');
  const back = lock.querySelector('.lock-back');

  if (!users.needsPassword(u.name)) { doLogin(u.name, ''); return; }
  usersBox.classList.add('hidden');
  pwd.classList.remove('hidden');
  back.classList.remove('hidden');
  const hint = pwd.querySelector('.pwd-hint');
  hint.textContent = u.name === 'root' ? 'подсказка: toor' : '';
  hint.classList.remove('err');
  setTimeout(() => pwd.querySelector('input').focus(), 60);
}

async function doLogin(name, pass) {
  const r = await users.login(name, pass);
  const pwd = lock.querySelector('.pwd');
  if (!r.ok) {
    const hint = pwd.querySelector('.pwd-hint');
    hint.textContent = r.error;
    hint.classList.add('err');
    pwd.classList.add('shake');
    setTimeout(() => pwd.classList.remove('shake'), 400);
    sound.error();
    return;
  }
  pwd.classList.add('hidden');
  lock.querySelector('.lock-back').classList.add('hidden');
  hideLock();
  sound.login();
  notify.success(`Добро пожаловать, ${r.user.label}`, '', { timeout: 2600, silent: true });
  setTimeout(restoreSession, 380);
}

function showLock() {
  renderLock();
  lock.classList.remove('hidden');
  lock.classList.remove('out');
  desktopEl.classList.remove('ready');
  desktopEl.classList.add('hidden');
}

function hideLock() {
  lock.classList.add('out');
  setTimeout(() => lock.classList.add('hidden'), 420);
  desktopEl.classList.remove('hidden');
  requestAnimationFrame(() => desktopEl.classList.add('ready'));
}

function lockSession() {
  if (desktopEl.classList.contains('hidden')) return;
  showLock();
  sound.logout();
}

async function shutdown() {
  wm.closeAll();
  await sleep(260);
  users.logout();
  desktopEl.classList.remove('ready');
  desktopEl.classList.add('hidden');
  await sleep(200);
  showLock();
  sound.logout();
}

async function restoreSession() {
  if (!settings.get('restoreSession', true)) return;
  const list = settings.get('lastSession', []);
  if (!Array.isArray(list) || !list.length) return;
  for (const appId of list.slice(0, 6)) {
    if (registry.get(appId)) {
      try { registry.launch(appId); } catch {}
      await sleep(90);
    }
  }
}

bus.on('win:open',  saveSessionSoon);
bus.on('win:close', saveSessionSoon);

let saveTimer = null;
function saveSessionSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ids = wm.list().map((w) => w.appId).filter(Boolean);
    await settings.set('lastSession', ids);
  }, 600);
}

/* ── Горячие клавиши ──────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const editing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

  if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); bus.emit('spotlight:toggle'); return; }
  if (e.altKey && e.key === 'Tab')     { e.preventDefault(); wm.cycle(e.shiftKey); return; }
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') { e.preventDefault(); lockSession(); return; }
  if (editing) return;

  if (e.key === 'Meta' || e.key === 'OS') { e.preventDefault(); taskbar.toggle('start'); return; }
  if (e.key === 'Escape') {
    if (spotlight.isOpen()) { spotlight.close(); return; }
    if (taskbar.isOpen())   { taskbar.closePop(); return; }
  }
  if (e.key === 'F5' && e.ctrlKey) { e.preventDefault(); location.reload(); }
});

/* ── Связь с шеллом ───────────────────────────────────────── */
bus.on('session:lock', lockSession);
bus.on('session:shutdown', shutdown);
bus.on('theme:toggle', async () => {
  const cur = settings.get('theme', 'dark');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'auto' : 'dark';
  await settings.set('theme', next);
  desktop.applyTheme(next);
  notify.info('Тема', next === 'auto' ? 'Следуем за системой' : next === 'dark' ? 'Тёмная' : 'Светлая', { timeout: 1600, silent: true });
});
bus.on('net:proxy', () => taskbar.renderTray());
bus.on('net:status', () => taskbar.renderTray());
bus.on('store:installed', () => desktop.render());

/* Форма пароля */
const pwdForm = lock.querySelector('.pwd');
pwdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingUser) return;
  doLogin(pendingUser.name, pwdForm.querySelector('input').value);
});
lock.querySelector('.lock-back').onclick = () => renderLock();

/* Старт */
bootSequence();

/* Экспорт в window.OS — для установленных приложений и отладки */
window.OS = {
  bus, db, settings, fs, users, processes, registry, wm,
  desktop, taskbar, spotlight, net, sound, notify, clipboard, icon,
  BOOT_TIME,
};