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
