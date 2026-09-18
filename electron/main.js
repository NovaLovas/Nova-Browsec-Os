/* main.js — Electron-хост NovaOS. Всё включено. */
const {
  app, BrowserWindow, session, protocol, desktopCapturer,
  shell, ipcMain, nativeTheme, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');

/* ── Флаги Chromium ──────────────────────────────────────────── */
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const IS_DEV = process.argv.includes('--dev');

/* ── Схема browsec:// ────────────────────────────────────────── */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'browsec',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.md':   'text/markdown; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const ROOT = path.join(__dirname, '..');

/* ── CSP для внутренних страниц ─────────────────────────────── */
const CSP = [
  "default-src 'self' browsec:",
  "script-src 'self' browsec: 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' browsec: 'unsafe-inline'",
  "img-src 'self' browsec: data: blob: https:",
  "font-src 'self' browsec: data:",
  "connect-src 'self' browsec: https: http: ws: wss: data:",
  "media-src 'self' browsec: blob: data: mediastream:",
  "frame-src 'self' browsec: https: http:",
  "worker-src 'self' browsec: blob:",
  "child-src 'self' browsec: blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https: http:",
].join('; ');

/* ── Главное окно ───────────────────────────────────────────── */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07080b',
    title: 'NovaOS',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.loadURL('browsec://app/index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

/* ── Безопасность webview ───────────────────────────────────── */
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;

    if (!/^https?:\/\//i.test(params.src)) {
      event.preventDefault();
      console.warn('[security] webview заблокирован:', params.src);
    }
    if (params.partition && !params.partition.startsWith('persist:browsec')) {
      params.partition = 'persist:browsec';
    }
  });

  contents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) {
      shell.openExternal(target).catch(() => {});
    }
    return { action: 'deny' };
  });

  if (contents === mainWindow?.webContents) {
    contents.on('will-navigate', (event, target) => {
      if (!target.startsWith('browsec://')) {
        event.preventDefault();
        if (/^https?:\/\//i.test(target)) shell.openExternal(target).catch(() => {});
      }
    });
  }
});

/* ── Доверенные origin для разрешений ───────────────────────── */
const TRUSTED_ORIGINS = new Set([
  'browsec://app',
  'https://meet.google.com',
  'https://discord.com',
  'https://web.telegram.org',
]);

function isTrustedOrigin(originUrl) {
  try {
    const u = new URL(originUrl);
    return TRUSTED_ORIGINS.has(`${u.protocol}//${u.host}`);
  } catch { return false; }
}

/* ── Регистрация IPC-хендлеров ──────────────────────────────── */
function registerIpc() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:name',    () => app.getName());
  ipcMain.handle('app:platform',() => process.platform);
  ipcMain.handle('app:arch',    () => process.arch);
  ipcMain.handle('app:paths',   () => ({
    home: app.getPath('home'),
    userData: app.getPath('userData'),
    temp: app.getPath('temp'),
    downloads: app.getPath('downloads'),
    documents: app.getPath('documents'),
    pictures: app.getPath('pictures'),
  }));
  ipcMain.handle('app:quit',    () => { app.quit(); });
  ipcMain.handle('app:relaunch',() => { app.relaunch(); app.exit(0); });
  ipcMain.handle('app:toggleDevTools', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    win?.webContents.toggleDevTools();
  });

  /* ── Диалоги ──────────────────────────────────────────── */
  ipcMain.handle('dialog:save', async (_e, options = {}) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showSaveDialog(win, {
      title: options.title || 'Сохранить как',
      defaultPath: options.defaultPath || undefined,
      filters: options.filters || [{ name: 'Все файлы', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null };
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('dialog:open', async (_e, options = {}) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showOpenDialog(win, {
      title: options.title || 'Открыть',
      properties: options.properties || ['openFile'],
      filters: options.filters || [{ name: 'Все файлы', extensions: ['*'] }],
      defaultPath: options.defaultPath || undefined,
      multiSelections: options.multiple === true,
    });
    if (result.canceled) return { canceled: true, filePaths: [] };
    return { canceled: false, filePaths: result.filePaths || [] };
  });

  ipcMain.handle('dialog:message', async (_e, options = {}) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showMessageBox(win, {
      type: options.type || 'info',
      title: options.title || 'NovaOS',
      message: options.message || '',
      detail: options.detail || '',
      buttons: options.buttons || ['OK'],
      defaultId: options.defaultId ?? 0,
      cancelId: options.cancelId ?? 0,
    });
    return { response: result.response, checkboxChecked: result.checkboxChecked };
  });

  /* ── Файлы на реальном диске ─────────────────────────── */
  ipcMain.handle('fs:writeFile', async (_e, filePath, data) => {
    try {
      if (typeof filePath !== 'string' || !filePath) throw new Error('Пустой путь');
      const buf = Buffer.from(data);
      fs.writeFileSync(filePath, buf);
      return { ok: true, path: filePath, size: buf.length };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('fs:readFile', async (_e, filePath) => {
    try {
      if (typeof filePath !== 'string' || !filePath) throw new Error('Пустой путь');
      if (!fs.existsSync(filePath)) throw new Error('Файл не найден');
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const isText = ['.txt','.md','.json','.js','.css','.html','.xml','.csv','.log','.yml','.yaml'].includes(ext);
      return {
        ok: true,
        path: filePath,
        size: data.length,
        text: isText ? data.toString('utf-8') : null,
        base64: isText ? null : data.toString('base64'),
        mime: MIME[ext] || 'application/octet-stream',
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('fs:exists', async (_e, filePath) => {
    try { return { ok: true, exists: fs.existsSync(filePath) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('fs:unlink', async (_e, filePath) => {
    try { fs.unlinkSync(filePath); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Shell ─────────────────────────────────────────────── */
  ipcMain.handle('shell:openExternal', async (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Разрешены только http/https' };
    }
    try { await shell.openExternal(url); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('shell:openPath', async (_e, filePath) => {
    try { await shell.openPath(filePath); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('shell:showItemInFolder', async (_e, filePath) => {
    try { shell.showItemInFolder(filePath); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Уведомления ОС ───────────────────────────────────── */
  ipcMain.handle('notify:system', async (_e, title, body) => {
    try {
      if (!BrowserWindow.getAllWindows().length) return { ok: false, error: 'Нет окна' };
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      if (!win) return { ok: false, error: 'Нет окна' };
      // Notification через Electron
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const n = new Notification({ title: String(title || 'NovaOS'), body: String(body || '') });
        n.show();
        return { ok: true };
      }
      return { ok: false, error: 'Уведомления не поддерживаются' };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Окно ─────────────────────────────────────────────── */
  ipcMain.handle('win:minimize', () => {
    const w = BrowserWindow.getFocusedWindow() || mainWindow;
    w?.minimize();
  });
  ipcMain.handle('win:maximize', () => {
    const w = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!w) return;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.handle('win:close', () => {
    const w = BrowserWindow.getFocusedWindow() || mainWindow;
    w?.close();
  });
  ipcMain.handle('win:fullscreen', () => {
    const w = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!w) return;
    w.setFullScreen(!w.isFullScreen());
  });
}

/* ── Инициализация ──────────────────────────────────────────── */
app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';

  /* ── Протокол browsec:// ──────────────────────────────── */
  protocol.handle('browsec', (req) => {
    try {
      const u = new URL(req.url);
      let rel = decodeURIComponent(u.pathname);
      if (!rel || rel === '/') rel = '/index.html';

      const filePath = path.normalize(path.join(ROOT, rel));
      if (!filePath.startsWith(ROOT)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not found: ' + rel, { status: 404 });
      }

      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const data = fs.readFileSync(filePath);

      const headers = {
        'Content-Type': type,
        'Cache-Control': 'no-store',
      };
      if (ext === '.html') headers['Content-Security-Policy'] = CSP;

      return new Response(data, { headers });
    } catch (e) {
      return new Response('Server error: ' + e.message, { status: 500 });
    }
  });

  /* ── Главная сессия ───────────────────────────────────── */
  const mainSession = session.defaultSession;

  mainSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details?.requestingUrl || wc?.getURL?.() || '';
    const trusted = isTrustedOrigin(origin);
    if (!trusted && !origin.startsWith('browsec://')) {
      return callback(false);
    }
    const allowed = new Set([
      'media', 'display-capture', 'clipboard-read', 'clipboard-write',
      'notifications', 'fullscreen', 'pointerLock',
    ]);
    callback(allowed.has(permission));
  });

  mainSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    const trusted = isTrustedOrigin(requestingOrigin) || requestingOrigin.startsWith('browsec://');
    if (!trusted) return false;
    return ['media', 'display-capture', 'clipboard-read', 'clipboard-write',
            'notifications', 'fullscreen', 'pointerLock'].includes(permission);
  });

  mainSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        if (!sources.length) return callback({});
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => callback({}));
  }, { useSystemPicker: true });

  /* ── Сессия webview ───────────────────────────────────── */
  const webviewSession = session.fromPartition('persist:browsec');

  webviewSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details?.requestingUrl || wc?.getURL?.() || '';
    const trusted = isTrustedOrigin(origin);
    const alwaysAllowed = new Set(['fullscreen', 'clipboard-read', 'clipboard-write', 'media']);
    const trustedOnly = new Set(['notifications', 'geolocation', 'display-capture', 'midi', 'midiSysex']);
    if (alwaysAllowed.has(permission)) return callback(true);
    if (trustedOnly.has(permission) && trusted) return callback(true);
    callback(false);
  });

  webviewSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        if (!sources.length) return callback({});
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => callback({}));
  }, { useSystemPicker: true });

  webviewSession.setUserAgent(
    webviewSession.getUserAgent()
      .replace(/Electron\/\S+\s/, '')
      .replace(/nova-os\/\S+\s/i, '')
  );

  /* ── Flush IndexedDB ──────────────────────────────────── */
  setInterval(() => {
    try { webviewSession.flushStorageData(); } catch {}
    try { mainSession.flushStorageData(); } catch {}
  }, 20000);

  /* ── IPC ──────────────────────────────────────────────── */
  registerIpc();

  /* ── Окно ─────────────────────────────────────────────── */
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  try {
    session.fromPartition('persist:browsec').flushStorageData();
    session.defaultSession.flushStorageData();
  } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandledRejection:', err);
});