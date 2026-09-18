/* net.js — сеть Browsec OS. Прямые CORS-запросы + опциональный прокси.
   Скачивание сохраняет файлы ВНУТРЬ ОС, не на реальный диск. */

import bus from '../kernel/bus.js';
import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import { settings } from '../kernel/db.js';

export const DIRECT_APIS = {
  weather:   'https://api.open-meteo.com/v1/forecast',
  geocode:   'https://geocoding-api.open-meteo.com/v1/search',
  wiki:      (lang) => `https://${lang}.wikipedia.org/api/rest_v1`,
  wikiSearch:(lang) => `https://${lang}.wikipedia.org/w/api.php`,
  hn:        'https://hacker-news.firebaseio.com/v0',
  crypto:    'https://api.coingecko.com/api/v3',
  github:    'https://api.github.com',
};

export const FRAME_BLOCKED = [
  'google.com','youtube.com','youtu.be','github.com','vk.com','facebook.com',
  'instagram.com','x.com','twitter.com','discord.com','web.telegram.org','t.me',
  'roblox.com','web.whatsapp.com','mail.ru','yandex.ru','netflix.com','twitch.tv',
  'reddit.com','linkedin.com','amazon.com','steampowered.com','open.spotify.com',
  'notion.so',
];

const state = {
  online: navigator.onLine,
  proxy: '',
  lastLatency: null,
  requests: 0,
  failures: 0,
};

export const net = {
  init() {
    state.proxy = settings.get('proxyUrl', '') || '';
    addEventListener('online',  () => { state.online = true;  bus.emit('net:status', { online: true }); });
    addEventListener('offline', () => { state.online = false; bus.emit('net:status', { online: false }); });
    return state;
  },

  status() { return { ...state }; },
  isOnline() { return state.online; },
  proxy() { return state.proxy; },

  async setProxy(url) {
    state.proxy = (url || '').trim().replace(/\/+$/, '');
    await settings.set('proxyUrl', state.proxy);
    bus.emit('net:proxy', state.proxy);
    return state.proxy;
  },

  viaProxy(url) {
    if (!state.proxy) return null;
    return state.proxy + (state.proxy.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url);
  },

  isFrameBlocked(url) {
    try {
      const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return FRAME_BLOCKED.some((d) => {
        const dd = d.replace(/^www\./, '');
        return h === dd || h.endsWith('.' + dd);
      });
    } catch { return false; }
  },

  async request(url, { method = 'GET', headers = {}, body = null, timeout = 15000, proxyFirst = false, raw = false } = {}) {
    if (!state.online) return { ok: false, error: 'offline', message: 'Нет подключения к сети' };
    state.requests++;

    const attempt = async (target, via) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      const t0 = performance.now();
      try {
        const r = await fetch(target, { method, headers, body, signal: ctl.signal, redirect: 'follow' });
        state.lastLatency = Math.round(performance.now() - t0);
        const text = raw ? null : await r.text();
        return {
          ok: r.ok, status: r.status, statusText: r.statusText, via,
          headers: r.headers, response: raw ? r : null, text,
          json: () => { try { return JSON.parse(text); } catch { return null; } },
          latency: state.lastLatency,
        };
      } catch (e) {
        return { ok: false, error: e.name === 'AbortError' ? 'timeout' : 'network', message: e.message, via };
      } finally { clearTimeout(t); }
    };

    const px = net.viaProxy(url);
    if (proxyFirst && px) {
      const r = await attempt(px, 'proxy');
      if (r.ok) return r;
    }

    let res = await attempt(url, 'direct');
    if (!res.ok && res.error && px) {
      const r2 = await attempt(px, 'proxy');
      if (r2.ok) return r2;
      res = r2.error ? res : r2;
    }
    if (!res.ok) state.failures++;
    if (!res.ok && !res.status && !px) {
      res.corsHint = true;
      res.message = 'Заблокировано политикой CORS. Нужен свой прокси — Настройки → Сеть.';
    }
    return res;
  },

  async json(url, opts = {}) {
    const r = await net.request(url, opts);
    if (!r.ok) throw Object.assign(new Error(r.message || `HTTP ${r.status}`), { net: r });
    const j = r.json();
    if (j === null) throw Object.assign(new Error('Ответ не является JSON'), { net: r });
    return j;
  },

  async ping(host = 'https://api.github.com/zen', { count = 3 } = {}) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const t0 = performance.now();
      try {
        await fetch(host, { method: 'GET', cache: 'no-store', mode: 'cors' });
        out.push(Math.round(performance.now() - t0));
      } catch {
        try {
          await fetch(host, { mode: 'no-cors', cache: 'no-store' });
          out.push(Math.round(performance.now() - t0));
        } catch { out.push(null); }
      }
      if (i < count - 1) await new Promise((r) => setTimeout(r, 180));
    }
    const good = out.filter((v) => v != null);
    return {
      host, samples: out, sent: count, received: good.length,
      loss: Math.round(((count - good.length) / count) * 100),
      min: good.length ? Math.min(...good) : null,
      max: good.length ? Math.max(...good) : null,
      avg: good.length ? Math.round(good.reduce((a, b) => a + b, 0) / good.length) : null,
    };
  },

  /* ── сохранение файлов ───────────────────────────────────── */

  /**
   * Сохранить данные ВНУТРЬ ОС — в ФС пользователя в /home/<user>/Загрузки.
   * Никаких клик по <a download>, ничего на реальный диск.
   */
  async saveBlob(data, filename, mime = 'application/octet-stream', dir = null) {
    const home = users.home();
    const targetDir = dir || fs.join(home, 'Загрузки');
    await fs.mkdir(targetDir, { recursive: true, quiet: true });

    // Разрешаем коллизии
    let name = filename || 'файл';
    let path = fs.join(targetDir, name);
    let i = 1;
    while (await fs.exists(path)) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      path = fs.join(targetDir, `${base} (${++i})${ext}`);
    }

    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    await fs.write(path, blob, { mime });
    bus.emit('net:saved', { path, size: blob.size, name });
    return path;
  },

  /**
   * Явное скачивание на реальный диск — только если пользователь сам нажал.
   * Помечено предупреждением в UI.
   */
  downloadToRealDisk(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    bus.emit('net:download-real', { url, filename });
    return true;
  },

  openExternal(url) {
    if (globalThis.BROWSEC_ELECTRON?.openExternal) {
      globalThis.BROWSEC_ELECTRON.openExternal(url);
      return true;
    }
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) { bus.emit('net:popup-blocked', url); return false; }
    return true;
  },

  probeFrame(url, timeout = 6000) {
    return new Promise((res) => {
      if (net.isFrameBlocked(url)) { res({ ok: false, reason: 'known-blocked' }); return; }
      const f = document.createElement('iframe');
      f.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      let done = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(t); f.remove(); res(r); };
      const t = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeout);
      f.onload = () => finish({ ok: true });
      f.onerror = () => finish({ ok: false, reason: 'error' });
      f.src = url;
      document.body.appendChild(f);
    });
  },
};

export default net;