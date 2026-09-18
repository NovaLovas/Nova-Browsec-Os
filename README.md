# Nova-Browsec-Os

# Browsec OS / NovaOS

> A complete operating system that runs entirely in your browser — or in Electron.
> No servers, no frameworks, no build step. Just HTML, CSS, and vanilla ES modules.

**Browsec OS** (also branded **NovaOS** in the desktop build) is a self-contained
desktop environment: window manager, taskbar, file system, terminal with Python,
browser with reader mode, encrypted password vault, and a small app store — all
inside a single browser tab. Everything is stored locally in IndexedDB.

---

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [Running in Electron](#running-in-electron)
- [Building installers](#building-installers)
- [Architecture](#architecture)
- [Filesystem layout](#filesystem-layout)
- [Writing your own app](#writing-your-own-app)
- [Custom proxy (Cloudflare Worker)](#custom-proxy-cloudflare-worker)
- [Hotkeys](#hotkeys)
- [Honest limitations](#honest-limitations)
- [License](#license)

---

## Features

**Shell**
- Window manager with drag, resize, snap-to-edge, tile, minimize-all
- Taskbar with Start menu, task list, tray, clock
- Spotlight search (`Ctrl+Space`) — apps, files, system commands, math
- Quick settings (Wi-Fi, DND, theme, brightness, volume)
- Notification center + toast notifications
- Desktop icons — drag to reposition, right-click context menus
- Lock screen with multi-user support, per-user password (SHA-256)
- Themes: dark / light / auto, 8 accent colors, 6 wallpapers, custom image

**Filesystem**
- Full path-based filesystem on IndexedDB
- POSIX-style permissions (`rwx`, octal), owners, groups
- Users: `user` (no password), `root` (password `toor`), `guest`
- `sudo` for one command, `chown` for real ownership changes
- Drag & drop files from your real disk into the virtual one

**Built-in apps (15)**
| App | What it does |
|-----|--------------|
| **Browser** | Tabs, history, bookmarks, reader mode for Wikipedia/HN |
| **Terminal** | 50+ shell commands + Python 3 (Pyodide WASM) + pip |
| **Files** | Two views, permissions, upload, download to real disk |
| **Editor** | Text editor with line numbers, wrap toggle |
| **Notes** | Markdown notes with autosave and live preview |
| **Calculator** | Custom expression parser (no `eval`), history, keyboard |
| **Clock** | Analog + digital, world zones, stopwatch, timer |
| **Music** | Procedural synth on Web Audio — tracks generated live |
| **Weather** | 7-day forecast via open-meteo (no API key) |
| **Paint** | Bitmap editor — brush, line, rect, ellipse |
| **Viewer** | Image viewer with zoom, rotate, gallery nav |
| **Camera** | Webcam capture → saves into `/home/<user>/Изображения` |
| **Passwords** | AES-GCM-256 vault, PBKDF2 (600k iters), generator |
| **Task manager** | Processes, memory estimate, storage usage |
| **Store** | Install mini-apps from a built-in catalog or by URL manifest |

**Networking**
- Direct CORS-friendly requests (Wikipedia, HN, weather, GitHub, ipapi)
- Optional Cloudflare Worker proxy for arbitrary sites
- Reader mode strips scripts, keeps clean HTML

**Sound**
- Every sound is synthesized live on Web Audio — no audio files
- 20+ system sounds (click, notify, error, boot, login, shutter…)

---

## Quick start

### Just open it

```bash
# Any static server works. From the repo root:
python -m http.server 8000
# or
npx serve
```

Then visit **http://localhost:8000** — that's it.

> ⚠️ **Do not open `index.html` via `file://`.** IndexedDB, ES modules, and
> several APIs are disabled in that context. Always use `http://localhost`.

### Dev server (included)

```bash
npm run serve        # runs scripts/serve.js on port 8080
```

---

## Running in Electron

```bash
npm install          # installs electron + electron-builder
npm start            # launches the desktop app
npm run dev          # same, with DevTools open
```

The Electron build gives you:
- A real desktop window (`browsec://` protocol, CSP-locked)
- `<webview>` in the Browser app with **persistent session** — logins survive
- Real filesystem dialogs (open/save on your actual disk)
- System notifications, screen capture, camera with system picker
- No CORS restrictions inside `<webview>` (it's a real Chromium frame)

---

## Building installers

```bash
npm run icons        # generate .ico / .icns / PNG set from assets/icon.png
npm run build:win    # NSIS installer + portable .exe
npm run build:linux  # AppImage + .deb
npm run build:mac    # .dmg (must run on macOS)
npm run build:all    # all three (mac target only on macOS)
```

Outputs go to `dist/`. You'll need `assets/icon.png` at least 1024×1024.

---

## Architecture

```
index.html
  └─ js/os.js                ← entry point, boots everything
       ├─ kernel/
       │    bus.js           ← event bus (pub/sub)
       │    db.js            ← IndexedDB wrapper (files, kv, blobs)
       │    fs.js            ← virtual filesystem on top of db
       │    users.js         ← users, login, SHA-256 passwords
       │    processes.js     ← process table
       ├─ shell/
       │    wm.js            ← window manager
       │    registry.js      ← app registry
       │    desktop.js       ← icons, wallpapers, accents
       │    taskbar.js       ← taskbar, Start menu, tray, panels
       │    spotlight.js     ← Ctrl+Space search
       ├─ services/
       │    net.js           ← HTTP, CORS, proxy, ping
       │    sound.js         ← Web Audio synth
       │    notify.js        ← toasts + notification center
       │    clipboard.js     ← isolated clipboard (does NOT touch real OS)
       │    vault.js         ← encrypted password vault
       ├─ ui/
       │    dom.js           ← helpers, dialogs, context menu
       │    icons.js         ← inline SVG icons (no CDN)
       │    markdown.js      ← safe Markdown renderer
       └─ apps/
            browser.js, terminal.js, files.js, editor.js, notes.js,
            calculator.js, clock.js, music.js, weather.js, paint.js,
            viewer.js, camera.js, passwords.js, taskmgr.js, store.js
```

### Event bus

Everything talks through `bus.js`:

```js
bus.on('win:open',    (w) => { /* ... */ });
bus.on('fs:change',   (e) => { /* path, op: create|update|delete|move */ });
bus.on('user:login',  (u) => { /* ... */ });
bus.emit('session:lock');
```

Full list of events: `win:*`, `fs:*`, `proc:*`, `user:*`, `session:*`,
`notify:*`, `net:*`, `clipboard:*`, `vault:*`, `store:installed`,
`spotlight:toggle`, `theme:toggle`.

### Filesystem

```
/home/user/        ← default user
/home/root/        ← root home
/home/guest/
/etc/apps/         ← installed store apps (.app JSON files)
/tmp/
/usr/
```

Permissions are real: `chmod`, `chown`, `sudo` all behave. `root` bypasses
all checks.

---

## Writing your own app

Drop this in the DevTools console (F12) — the app appears in the Start menu:

```js
OS.registry.register({
  id: 'hello',
  name: 'Привет',
  icon: 'star',
  color: 'linear-gradient(135deg,#a78bfa,#f472b6)',
  category: 'Прочее',
  width: 520,
  height: 320,
  mount(root, win, args) {
    root.innerHTML = `
      <div class="pad">
        <h2>Привет из своего приложения</h2>
        <p>Аргументы: ${JSON.stringify(args)}</p>
      </div>`;
    win.setTitle('Готово');
  }
});
OS.registry.launch('hello');
```

### What `mount` receives

| Parameter | What it is |
|-----------|-----------|
| `root`    | A `div.win-body` — put your UI here |
| `win`     | Window API: `setTitle`, `close`, `onCleanup`, `onBeforeClose` |
| `args`    | Whatever was passed to `OS.registry.launch('id', args)` |

### Public API — `window.OS`

```js
OS.fs.read(path)                // string | Blob
OS.fs.write(path, content)      // content can be string or Blob
OS.fs.list(path)                // Node[]
OS.fs.mkdir(path, {recursive})  // Node
OS.fs.remove(path, {recursive})
OS.fs.move(from, to)
OS.fs.copy(from, to)
OS.fs.chmod(path, 0o755)
OS.fs.chown(path, 'user', 'users')
OS.fs.find(query)
OS.fs.du(path)                  // bytes

OS.notify.info(t, m)
OS.notify.success(t, m)         // also warn / error

OS.clipboard.set(text)
OS.clipboard.get()

OS.registry.register(manifest)  // see above
OS.registry.launch(id, args)
OS.registry.all()

OS.settings.get(key, default)
OS.settings.set(key, value)

OS.users.current()              // {name, label, groups, root}
OS.users.home()                 // "/home/user"

OS.bus.on(event, fn)
OS.bus.emit(event, data)

OS.wm.list()                    // open windows
OS.wm.focus(id)
OS.wm.close(id)
```

### Installing from URL

The Store can install a manifest from any URL:

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "star",
  "color": "linear-gradient(135deg,#a78bfa,#f472b6)",
  "category": "Прочее",
  "desc": "Short description",
  "width": 500,
  "height": 400,
  "keywords": ["demo"],
  "html": "<!DOCTYPE html><html>…"
}
```

Or `"html_url": "https://…/app.html"` to load the HTML separately.

Installed apps are stored in `/etc/apps/<id>.app` and run in a sandboxed
iframe. They talk to the OS through a `window.OS` proxy that's injected
via `postMessage` — `fs`, `notify`, `clipboard`, and `window.setTitle` work
exactly like in first-party apps.

---

## Custom proxy (Cloudflare Worker)

Browsers block cross-origin requests without CORS headers. A proxy fixes
this **honestly** — you run it yourself, no third party sees your traffic.

`worker/proxy.js` is a complete Cloudflare Worker:

```bash
npm i -g wrangler
wrangler deploy worker/proxy.js --name browsec-proxy
```

Then paste the URL into **Settings → Network → Proxy URL**:

```
https://browsec-proxy.<your-subdomain>.workers.dev/
```

The worker:
- Accepts `?url=<encoded>`
- Forwards GET / HEAD
- Adds `Access-Control-Allow-Origin: *`
- Blocks private hosts (`10.*`, `192.168.*`, `localhost`, `*.local`) — SSRF-safe
- Drops `Set-Cookie` and CSP headers so the response is usable
- Caches for 60 seconds

Test it from the terminal:

```bash
curl https://browsec-proxy.you.workers.dev/?url=https%3A%2F%2Fexample.com
```

---

## Hotkeys

| Keys | Action |
|------|--------|
| `Win` / `Super` | Toggle Start menu |
| `Ctrl` + `Space` | Spotlight search |
| `Alt` + `Tab` | Cycle windows (Shift for reverse) |
| `Ctrl` + `Alt` + `L` | Lock session |
| `Alt` + `1…9` | Jump to the Nth taskbar item |
| `Ctrl` + `T` | New browser tab |
| `Ctrl` + `W` | Close current browser tab |
| `Ctrl` + `L` | Focus browser URL bar |
| `Ctrl` + `R` | Reload current page |
| `Ctrl` + `Tab` | Next browser tab |

In the terminal:
| | |
|---|---|
| `Tab` | Autocomplete |
| `↑` / `↓` | Command history |
| `Ctrl` + `L` | Clear screen |
| `Ctrl` + `C` | Cancel current input |

---

## Honest limitations

This is a browser, not an OS. Some things are physically impossible:

- **CORS** — direct fetch to another origin without CORS headers is blocked.
  Only a proxy fixes it. See [Custom proxy](#custom-proxy-cloudflare-worker).
- **X-Frame-Options** — YouTube, Google, VK, GitHub, Discord, Telegram,
  Roblox, etc. forbid being framed. Browsec OS detects this and offers
  "Open in system browser".
- **No native apps** — Discord / Telegram / Roblox can't run inside a tab.
- **`file://`** — IndexedDB, ES modules, and clipboard are disabled there.
  Always use `http://localhost` or HTTPS.
- **Camera / microphone** — require a secure context. `localhost` counts;
  plain `http://192.168.x.x` does not.
- **Memory numbers** in Task Manager are estimates. Browsers do not expose
  per-tab memory to JavaScript.
- **Clipboard** — Browsec OS keeps its own clipboard to avoid fighting with
  the real one. Use the buttons in apps to explicitly transfer.

---

## License

MIT — see `assets/LICENSE.txt`.

Built with zero dependencies. Everything you see is HTML, CSS, and JavaScript.
```

---

# README.ru.md

```markdown
# Browsec OS / NovaOS

> Полноценная операционная система, работающая целиком в браузере — или в Electron.
> Без серверов, без фреймворков, без сборки. Только HTML, CSS и ванильные ES-модули.

**Browsec OS** (в desktop-сборке брендируется как **NovaOS**) — это
самодостаточная среда рабочего стола: оконный менеджер, панель задач,
файловая система, терминал с Python, браузер с режимом чтения, шифрованное
хранилище паролей и небольшой магазин приложений — всё внутри одной вкладки.
Данные хранятся локально в IndexedDB.

---

## Содержание

- [Возможности](#возможности)
- [Быстрый старт](#быстрый-старт)
- [Запуск в Electron](#запуск-в-electron)
- [Сборка установщиков](#сборка-установщиков)
- [Архитектура](#архитектура)
- [Структура файловой системы](#структура-файловой-системы)
- [Своё приложение за 10 строк](#своё-приложение-за-10-строк)
- [Свой прокси (Cloudflare Worker)](#свой-прокси-cloudflare-worker)
- [Горячие клавиши](#горячие-клавиши)
- [Честные ограничения](#честные-ограничения)
- [Лицензия](#лицензия)

---

## Возможности

**Оболочка**
- Оконный менеджер: перетаскивание, ресайз, снап к краям, плитка, свернуть все
- Панель задач: Пуск, список окон, трей, часы
- Spotlight-поиск (`Ctrl+Space`) — приложения, файлы, команды, математика
- Быстрые настройки (Wi-Fi, «не беспокоить», тема, яркость, громкость)
- Центр уведомлений + тосты
- Иконки рабочего стола — перетаскивание, контекстные меню
- Экран блокировки с многопользовательским входом, пароль SHA-256
- Темы: тёмная / светлая / авто, 8 акцентов, 6 обоев, своя картинка

**Файловая система**
- Полноценная ФС по путям на IndexedDB
- POSIX-права (`rwx`, восьмеричные), владельцы, группы
- Пользователи: `user` (без пароля), `root` (пароль `toor`), `guest`
- `sudo` для одной команды, `chown` для смены владельца
- Drag & drop файлов с реального диска в виртуальный

**Встроенные приложения (15)**
| Приложение | Что делает |
|-----------|-----------|
| **Браузер** | Вкладки, история, закладки, режим чтения (Википедия/HN) |
| **Терминал** | 50+ shell-команд + Python 3 (Pyodide WASM) + pip |
| **Файлы** | Два вида, права, загрузка, сохранение на реальный диск |
| **Редактор** | Текстовый редактор с номерами строк и переносом |
| **Заметки** | Markdown с автосохранением и предпросмотром |
| **Калькулятор** | Свой парсер выражений (без `eval`), история, клавиатура |
| **Часы** | Аналоговые + цифровые, мировые зоны, секундомер, таймер |
| **Музыка** | Синтез на Web Audio — треки генерируются в реальном времени |
| **Погода** | Прогноз на 7 дней через open-meteo (без API-ключа) |
| **Paint** | Растровый редактор: кисть, линия, прямоугольник, эллипс |
| **Просмотр** | Просмотр изображений: зум, поворот, навигация по папке |
| **Камера** | Веб-камера → снимок в `/home/<user>/Изображения` |
| **Пароли** | AES-GCM-256, PBKDF2 (600k итераций), генератор |
| **Диспетчер задач** | Процессы, оценка памяти, использование хранилища |
| **Магазин** | Установка мини-приложений из каталога или по URL |

**Сеть**
- Прямые CORS-запросы (Википедия, HN, погода, GitHub, ipapi)
- Опциональный Cloudflare Worker-прокси для произвольных сайтов
- Режим чтения вырезает скрипты, оставляет чистый HTML

**Звук**
- Все звуки синтезируются на Web Audio — никаких файлов
- 20+ системных звуков (клик, уведомление, ошибка, загрузка, вход, затвор…)

---

## Быстрый старт

### Просто открой

```bash
# Подойдёт любой статический сервер. Из корня репозитория:
python -m http.server 8000
# или
npx serve
```

Затем открой **http://localhost:8000** — и всё.

> ⚠️ **Не открывай `index.html` через `file://`.** IndexedDB, ES-модули
> и часть API в этом контексте отключены. Всегда используй `http://localhost`.

### Встроенный dev-сервер

```bash
npm run serve        # запускает scripts/serve.js на порту 8080
```

---

## Запуск в Electron

```bash
npm install          # установит electron + electron-builder
npm start            # запускает desktop-приложение
npm run dev          # то же, но с открытым DevTools
```

Electron-сборка даёт:
- Настоящее окно (`browsec://` протокол, CSP изолирован)
- `<webview>` в Браузере с **постоянной сессией** — логины сохраняются
- Реальные диалоги файловой системы (открытие/сохранение на диск)
- Системные уведомления, захват экрана, камера с системным выбором
- Никаких CORS-ограничений внутри `<webview>` (это настоящий Chromium-фрейм)

---

## Сборка установщиков

```bash
npm run icons        # генерирует .ico / .icns / PNG-набор из assets/icon.png
npm run build:win    # NSIS-установщик + portable .exe
npm run build:linux  # AppImage + .deb
npm run build:mac    # .dmg (только на macOS)
npm run build:all    # все три (mac — только на macOS)
```

Результаты в `dist/`. Нужен `assets/icon.png` минимум 1024×1024.

---

## Архитектура

```
index.html
  └─ js/os.js                ← точка входа, запускает всё
       ├─ kernel/
       │    bus.js           ← шина событий (pub/sub)
       │    db.js            ← обёртка IndexedDB (files, kv, blobs)
       │    fs.js            ← виртуальная ФС поверх db
       │    users.js         ← пользователи, вход, SHA-256
       │    processes.js     ← таблица процессов
       ├─ shell/
       │    wm.js            ← оконный менеджер
       │    registry.js      ← реестр приложений
       │    desktop.js       ← иконки, обои, акценты
       │    taskbar.js       ← панель задач, Пуск, трей, панели
       │    spotlight.js     ← поиск по Ctrl+Space
       ├─ services/
       │    net.js           ← HTTP, CORS, прокси, пинг
       │    sound.js         ← Web Audio-синтез
       │    notify.js        ← тосты + центр уведомлений
       │    clipboard.js     ← изолированный буфер (реальный не трогает)
       │    vault.js         ← шифрованное хранилище паролей
       ├─ ui/
       │    dom.js           ← помощники, диалоги, контекстное меню
       │    icons.js         ← inline SVG-иконки (без CDN)
       │    markdown.js      ← безопасный Markdown-рендерер
       └─ apps/
            browser.js, terminal.js, files.js, editor.js, notes.js,
            calculator.js, clock.js, music.js, weather.js, paint.js,
            viewer.js, camera.js, passwords.js, taskmgr.js, store.js
```

### Шина событий

Всё общается через `bus.js`:

```js
bus.on('win:open',    (w) => { /* ... */ });
bus.on('fs:change',   (e) => { /* path, op: create|update|delete|move */ });
bus.on('user:login',  (u) => { /* ... */ });
bus.emit('session:lock');
```

Полный список событий: `win:*`, `fs:*`, `proc:*`, `user:*`, `session:*`,
`notify:*`, `net:*`, `clipboard:*`, `vault:*`, `store:installed`,
`spotlight:toggle`, `theme:toggle`.

### Файловая система

```
/home/user/        ← пользователь по умолчанию
/home/root/        ← домашняя папка root
/home/guest/
/etc/apps/         ← установленные приложения из магазина (.app JSON)
/tmp/
/usr/
```

Права настоящие: `chmod`, `chown`, `sudo` работают. `root` обходит все
проверки.

---

## Своё приложение за 10 строк

Вставь в консоль браузера (F12) — приложение появится в меню «Пуск»:

```js
OS.registry.register({
  id: 'hello',
  name: 'Привет',
  icon: 'star',
  color: 'linear-gradient(135deg,#a78bfa,#f472b6)',
  category: 'Прочее',
  width: 520,
  height: 320,
  mount(root, win, args) {
    root.innerHTML = `
      <div class="pad">
        <h2>Привет из своего приложения</h2>
        <p>Аргументы: ${JSON.stringify(args)}</p>
      </div>`;
    win.setTitle('Готово');
  }
});
OS.registry.launch('hello');
```

### Что получает `mount`

| Параметр | Что это |
|----------|---------|
| `root`   | `div.win-body` — сюда вставляй UI |
| `win`    | API окна: `setTitle`, `close`, `onCleanup`, `onBeforeClose` |
| `args`   | То, что передали в `OS.registry.launch('id', args)` |

### Публичный API — `window.OS`

```js
OS.fs.read(path)                // строка | Blob
OS.fs.write(path, content)      // content — строка или Blob
OS.fs.list(path)                // Node[]
OS.fs.mkdir(path, {recursive})  // Node
OS.fs.remove(path, {recursive})
OS.fs.move(from, to)
OS.fs.copy(from, to)
OS.fs.chmod(path, 0o755)
OS.fs.chown(path, 'user', 'users')
OS.fs.find(query)
OS.fs.du(path)                  // байт

OS.notify.info(t, m)
OS.notify.success(t, m)         // также warn / error

OS.clipboard.set(text)
OS.clipboard.get()

OS.registry.register(manifest)  // см. выше
OS.registry.launch(id, args)
OS.registry.all()

OS.settings.get(key, default)
OS.settings.set(key, value)

OS.users.current()              // {name, label, groups, root}
OS.users.home()                 // "/home/user"

OS.bus.on(event, fn)
OS.bus.emit(event, data)

OS.wm.list()                    // открытые окна
OS.wm.focus(id)
OS.wm.close(id)
```

### Установка по URL

Магазин умеет ставить приложения по манифесту с любого URL:

```json
{
  "id": "my-app",
  "name": "My App",
  "icon": "star",
  "color": "linear-gradient(135deg,#a78bfa,#f472b6)",
  "category": "Прочее",
  "desc": "Короткое описание",
  "width": 500,
  "height": 400,
  "keywords": ["demo"],
  "html": "<!DOCTYPE html><html>…"
}
```

Либо `"html_url": "https://…/app.html"` — HTML грузится отдельно.

Установленные приложения лежат в `/etc/apps/<id>.app` и запускаются в
песочнице-iframe. С ОС общаются через прокси `window.OS`, инжектируемый
через `postMessage` — `fs`, `notify`, `clipboard` и `window.setTitle`
работают точно так же, как во встроенных приложениях.

---

## Свой прокси (Cloudflare Worker)

Браузер блокирует кросс-доменные запросы без CORS-заголовков. Прокси
решает это **честно** — ты запускаешь его сам, никакие третьи стороны
не видят твой трафик.

`worker/proxy.js` — готовый Cloudflare Worker:

```bash
npm i -g wrangler
wrangler deploy worker/proxy.js --name browsec-proxy
```

Затем вставь URL в **Настройки → Сеть → URL прокси**:

```
https://browsec-proxy.<your-subdomain>.workers.dev/
```

Воркер:
- Принимает `?url=<encoded>`
- Проксирует GET / HEAD
- Добавляет `Access-Control-Allow-Origin: *`
- Блокирует приватные адреса (`10.*`, `192.168.*`, `localhost`, `*.local`) — защита от SSRF
- Выкидывает `Set-Cookie` и CSP-заголовки, чтобы ответ был пригоден
- Кэширует на 60 секунд

Проверь из терминала:

```bash
curl https://browsec-proxy.you.workers.dev/?url=https%3A%2F%2Fexample.com
```

---

## Горячие клавиши

| Клавиши | Действие |
|---------|----------|
| `Win` / `Super` | Меню «Пуск» |
| `Ctrl` + `Space` | Spotlight-поиск |
| `Alt` + `Tab` | Переключение окон (Shift — обратно) |
| `Ctrl` + `Alt` + `L` | Заблокировать сессию |
| `Alt` + `1…9` | Перейти к N-му окну на панели задач |
| `Ctrl` + `T` | Новая вкладка браузера |
| `Ctrl` + `W` | Закрыть вкладку браузера |
| `Ctrl` + `L` | Фокус на адресную строку |
| `Ctrl` + `R` | Обновить страницу |
| `Ctrl` + `Tab` | Следующая вкладка |

В терминале:
| | |
|---|---|
| `Tab` | Автодополнение |
| `↑` / `↓` | История команд |
| `Ctrl` + `L` | Очистить экран |
| `Ctrl` + `C` | Отменить ввод |

---

## Честные ограничения

Это браузер, а не ОС. Некоторые вещи физически невозможны:

- **CORS** — прямой запрос к чужому origin без CORS-заголовков блокируется.
  Обход — только свой прокси. См. [Свой прокси](#свой-прокси-cloudflare-worker).
- **X-Frame-Options** — YouTube, Google, VK, GitHub, Discord, Telegram,
  Roblox и другие запрещают встраивание. Browsec OS это определяет и
  предлагает «Открыть в системном браузере».
- **Нативные приложения** — Discord / Telegram / Roblox не могут
  работать внутри вкладки.
- **`file://`** — IndexedDB, ES-модули и буфер обмена отключены. Всегда
  используй `http://localhost` или HTTPS.
- **Камера и микрофон** — требуют защищённого контекста. `localhost`
  подходит; `http://192.168.x.x` — нет.
- **Память** в диспетчере — оценка. Браузер не отдаёт JS точную память
  вкладки.
- **Буфер обмена** — Browsec OS держит свой буфер, чтобы не конфликтовать
  с реальным. Для обмена используй кнопки в приложениях.

---

## Лицензия

MIT — см. `assets/LICENSE.txt`.

Собрано без единой зависимости. Всё, что ты видишь — HTML, CSS и JavaScript.
```

---

Both files are ready to drop into the repo root. `README.md` is the English one, `README.ru.md` is Russian. GitHub automatically shows `README.md` on the repo page and adds a language picker for the alternate one if you name it `README.ru.md`.
