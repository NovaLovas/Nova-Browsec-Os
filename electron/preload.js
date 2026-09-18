/* preload.js — мост между ядром NovaOS и Electron. Всё включено. */

const { contextBridge, shell, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('BROWSEC_ELECTRON', {
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  },

  /* ── Ссылки и файлы ──────────────────────────────────── */
  openExternal: (url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return Promise.resolve(false);
    return ipcRenderer.invoke('shell:openExternal', url).then((r) => r.ok).catch(() => false);
  },

  openPath: (filePath) => {
    if (typeof filePath !== 'string') return Promise.resolve(false);
    return ipcRenderer.invoke('shell:openPath', filePath).then((r) => r.ok).catch(() => false);
  },

  showItemInFolder: (filePath) => {
    if (typeof filePath !== 'string') return Promise.resolve(false);
    return ipcRenderer.invoke('shell:showItemInFolder', filePath).then((r) => r.ok).catch(() => false);
  },

  /* ── Диалоги ─────────────────────────────────────────── */
  saveFileAs: async (options = {}) => {
    const r = await ipcRenderer.invoke('dialog:save', options);
    return r.canceled ? null : r.filePath;
  },

  openFileDialog: async (options = {}) => {
    const r = await ipcRenderer.invoke('dialog:open', options);
    return r.canceled ? [] : r.filePaths;
  },

  showMessageBox: async (options = {}) => {
    return ipcRenderer.invoke('dialog:message', options);
  },

  /* ── Файлы на реальном диске ─────────────────────────── */
  fs: {
    writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    unlink: (filePath) => ipcRenderer.invoke('fs:unlink', filePath),

    /** Сохранить Blob/строку через диалог. Возвращает путь или null. */
    saveAs: async (data, defaultName = 'file.bin') => {
      const filePath = await contextBridge.exposeInMainWorld ? null : null;
      const r = await ipcRenderer.invoke('dialog:save', {
        title: 'Сохранить как',
        defaultPath: defaultName,
      });
      if (r.canceled || !r.filePath) return null;
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data)
        : typeof data === 'string' ? data
        : data;
      const res = await ipcRenderer.invoke('fs:writeFile', r.filePath, buf);
      return res.ok ? r.filePath : null;
    },
  },

  /* ── Окно ─────────────────────────────────────────────── */
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    fullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  },

  /* ── Приложение ──────────────────────────────────────── */
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    name: () => ipcRenderer.invoke('app:name'),
    platform: () => ipcRenderer.invoke('app:platform'),
    arch: () => ipcRenderer.invoke('app:arch'),
    paths: () => ipcRenderer.invoke('app:paths'),
    quit: () => ipcRenderer.invoke('app:quit'),
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
    toggleDevTools: () => ipcRenderer.invoke('app:toggleDevTools'),
  },

  /* ── Уведомления ОС ──────────────────────────────────── */
  systemNotify: (title, body) => {
    return ipcRenderer.invoke('notify:system', title, body).then((r) => r.ok).catch(() => false);
  },
});