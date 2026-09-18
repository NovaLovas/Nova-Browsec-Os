/* browser.js — браузер NovaOS.
   Electron: <webview> с постоянной сессией persist:browsec — логины сохраняются.
   Обычный браузер: <iframe>.

   Живые вкладки: у каждой вкладки свой persistent host-элемент в общем контейнере.
   Переключение вкладки = display:none/block. Ничего не пересоздаётся.
*/

import bus from '../kernel/bus.js';
import { settings } from '../kernel/db.js';
import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import registry from '../shell/registry.js';
import net from '../services/net.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';
import icon from '../ui/icons.js';
import { h, esc, fmtAgo, contextMenu, emptyState } from '../ui/dom.js';
import { readerFor, searchWiki } from './reader.js';

const IS_ELECTRON = !!globalThis.BROWSEC_ELECTRON?.isElectron;

const START_TILES = [
  { name: 'Википедия',   url: 'https://ru.wikipedia.org/wiki/Заглавная_страница', c: '#94a3b8', mode: 'Чтение' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com/',                    c: '#f59e0b', mode: 'Чтение' },
  { name: 'MDN',         url: 'https://developer.mozilla.org/ru/',                c: '#111827', mode: 'Чтение' },
  { name: 'Example',     url: 'https://example.com/',                             c: '#64748b', mode: 'В окне' },
  { name: 'YouTube',     url: 'https://www.youtube.com/',                         c: '#ef4444', mode: 'Внешне' },
  { name: 'Telegram',    url: 'https://web.telegram.org/',                        c: '#38bdf8', mode: 'Внешне' },
  { name: 'Discord',     url: 'https://discord.com/app',                          c: '#5865f2', mode: 'Внешне' },
  { name: 'GitHub',      url: 'https://github.com/',                              c: '#24292e', mode: 'Внешне' },
];

const norm = (raw) => {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (/^(https?|about):/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/|$|:\d)/.test(s)) return 'https://' + s;
  return `https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(s)}`;
};

function mount(root, win, args) {
  let tabs = [];
  let active = 0;
  let history = settings.get('brHistory', []) || [];
  let marks = settings.get('brMarks', []) || [];

  root.innerHTML = `
    <div class="app">
      <div class="br-tabs"></div>
      <div class="br-nav">
        <button class="br-nb" data-a="back" title="Назад">${icon('chevronLeft')}</button>
        <button class="br-nb" data-a="fwd" title="Вперёд">${icon('chevronRight')}</button>
        <button class="br-nb" data-a="reload" title="Обновить">${icon('refresh')}</button>
        <button class="br-nb" data-a="home" title="Домой">${icon('home')}</button>
        <div class="br-url">
          <span class="lk">${icon('lock')}</span>
          <input placeholder="Адрес или поиск" spellcheck="false" aria-label="Адрес">
        </div>
        <button class="br-nb" data-a="reader" title="Режим чтения">${icon('fileText')}</button>
        <button class="br-nb" data-a="mark" title="В закладки">${icon('bookmark')}</button>
        <button class="br-nb" data-a="ext" title="Открыть в системном браузере">${icon('external')}</button>
        <button class="br-nb" data-a="menu" title="Меню">${icon('moreV')}</button>
      </div>
      <div class="br-view"></div>
    </div>`;

  const tabsEl = root.querySelector('.br-tabs');
  const view = root.querySelector('.br-view');
  const urlInp = root.querySelector('.br-url input');
  const lockEl = root.querySelector('.br-url .lk');

  const cur = () => tabs[active];
  const isActive = (t) => tabs[active] === t;
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  /* ── Хосты вкладок: у каждой вкладки свой постоянный контейнер ────── */
  function ensureHost(t) {
    if (t.host) return t.host;
    const host = document.createElement('div');
    host.className = 'br-host';
    host.style.cssText = 'position:absolute;inset:0;display:none;overflow:hidden';
    view.appendChild(host);
    t.host = host;
    return host;
  }

  function activateHost(t) {
    for (const tab of tabs) {
      if (tab.host) tab.host.style.display = (tab === t) ? '' : 'none';
    }
  }

  function destroyHost(t) {
    if (!t.host) return;
    try { t.wv?.stop?.(); } catch {}
    t.wv = null;
    t.host.remove();
    t.host = null;
    t.renderedUrl = null;
    t.renderedMode = null;
  }

  /* ── Сохранение сессии ──────────────────────────────────────────── */
  let saveSessionTimer = null;
  function saveSessionNow() {
    clearTimeout(saveSessionTimer);
    saveSessionTimer = setTimeout(async () => {
      const snapshot = {
        active,
        tabs: tabs.map((t) => ({ url: t.url, title: t.title })).filter((t) => t.url),
        at: Date.now(),
      };
      await settings.set('brSession', snapshot);
    }, 400);
  }
  const saveSession = saveSessionNow;

  /* ── Вкладки ────────────────────────────────────────────────────── */
  function newTab(url = null, { activate = true } = {}) {
    const t = {
      url,
      title: url ? 'Загрузка…' : 'Новая вкладка',
      stack: [],
      sp: -1,
      mode: 'start',
      loading: false,
      host: null,
      wv: null,
      renderedUrl: null,
      renderedMode: null,
    };
    tabs.push(t);
    if (activate) active = tabs.length - 1;
    renderTabs();
    if (url) navigate(url);
    else renderView();
    saveSession();
    return t;
  }

  function closeTab(i) {
    const t = tabs[i];
    if (!t) return;
    destroyHost(t);
    tabs.splice(i, 1);
    if (!tabs.length) { newTab(); return; }
    if (active >= tabs.length) active = tabs.length - 1;
    else if (active > i) active--;
    renderTabs(); renderView(); saveSession();
  }

  function switchTo(i) {
    if (i === active) return;
    active = i;
    renderTabs();
    renderView();
    saveSession();
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    tabs.forEach((t, i) => {
      let letter = '•';
      try { if (t.url) letter = new URL(t.url).hostname.replace(/^www\./, '')[0].toUpperCase(); } catch {}
      const el = h(`
        <button class="br-tab ${i === active ? 'on' : ''}" title="${esc(t.title)}">
          <span class="fv">${t.loading ? '' : esc(letter)}</span>
          <span class="tt">${esc(t.title)}</span>
          <span class="x">${icon('x')}</span>
        </button>`);
      if (t.loading) el.querySelector('.fv').innerHTML = '<span class="spin" style="width:11px;height:11px;border-width:1.5px"></span>';
      el.onclick = (e) => { if (e.target.closest('.x')) return; switchTo(i); };
      el.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeTab(i); };
      // middle-click closes
      el.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } };
      tabsEl.appendChild(el);
    });
    const add = h(`<button class="br-newtab" title="Новая вкладка">${icon('plus')}</button>`);
    add.onclick = () => newTab();
    tabsEl.appendChild(add);
  }

  function syncNav() {
    const t = cur();
    urlInp.value = t?.url || '';
    lockEl.classList.toggle('secure', !!t?.url?.startsWith('https:'));
    root.querySelector('[data-a="back"]').disabled = !t || t.sp <= 0;
    root.querySelector('[data-a="fwd"]').disabled = !t || t.sp >= t.stack.length - 1;
    root.querySelector('[data-a="mark"]').classList.toggle('on', !!t?.url && marks.some((m) => m.url === t.url));
    win.setTitle(t?.title ? `${t.title} — Браузер` : 'Браузер');
  }

  async function pushHistory(url, title) {
    history = [{ url, title, at: Date.now() }, ...history.filter((x) => x.url !== url)].slice(0, 200);
    await settings.set('brHistory', history);
  }

  /* ── Навигация ──────────────────────────────────────────────────── */
  async function navigate(rawUrl, { push = true, force = false, forceReader = false } = {}) {
    const t = cur();
    const url = norm(rawUrl);
    if (!url) return;

    if (push && t.url !== url) {
      t.stack = [...t.stack.slice(0, t.sp + 1), url];
      t.sp = t.stack.length - 1;
    } else if (t.sp < 0) { t.stack = [url]; t.sp = 0; }

    // при смене URL сбрасываем кэш отрисовки этой вкладки
    if (t.renderedUrl !== url) {
      t.renderedUrl = null;
      t.renderedMode = null;
    }

    t.url = url;
    t.loading = true;
    t.title = hostOf(url);
    renderTabs(); syncNav(); saveSession();

    const blocked = IS_ELECTRON ? false : net.isFrameBlocked(url);
    const wantReader = forceReader || readerFor(url) !== null;

    // В обычном браузере всегда пробуем режим чтения — iframe почти везде запрещён
    if (!IS_ELECTRON && wantReader) {
      const okReader = await showReader(url);
      if (okReader) { t.loading = false; renderTabs(); return; }
    }
    // В Electron — только по явной кнопке
    if (IS_ELECTRON && forceReader && wantReader) {
      const okReader = await showReader(url);
      if (okReader) { t.loading = false; renderTabs(); return; }
    }

    if (blocked) {
      t.mode = 'blocked';
      t.loading = false;
      renderTabs();
      showBlocked(url);
      return;
    }

    t.mode = 'frame';
    showFrame(url, force);
  }

  /* ── Отрисовка фрейма во вкладке ────────────────────────────────── */
  function showFrame(url, force) {
    const t = cur();
    const host = ensureHost(t);
    activateHost(t);

    // Кэш: если этот же URL уже отрисован в этой вкладке — не трогаем
    if (!force && t.renderedUrl === url && t.renderedMode === 'frame' && t.wv) {
      // если вкладка была в другом режиме, но фрейм цел — просто вернём его
      return;
    }

    // Чистим предыдущее содержимое хоста
    try { t.wv?.stop?.(); } catch {}
    t.wv = null;
    host.innerHTML = '';
    t.renderedUrl = url;
    t.renderedMode = 'frame';

    const prog = h(`<div class="br-prog" style="width:22%"></div>`);
    host.appendChild(prog);

    if (IS_ELECTRON) {
      const wv = document.createElement('webview');

      // ⚠️ Порядок критичен: сначала partition, потом всё остальное, src — последним.
      wv.setAttribute('partition', 'persist:browsec');
      wv.setAttribute('allowpopups', 'true');
      wv.setAttribute('useragent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
      wv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#fff';
      wv.setAttribute('src', url);
      t.wv = wv;
      host.appendChild(wv);

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        prog.style.width = '100%';
        setTimeout(() => prog.remove(), 300);
        t.loading = false;
        renderTabs();
        if (isActive(t)) syncNav();
      };

      wv.addEventListener('did-start-loading', () => { prog.style.width = '25%'; });
      wv.addEventListener('did-stop-loading', () => {
        done();
        t.title = (wv.getTitle && wv.getTitle()) || hostOf(url);
        renderTabs();
        if (isActive(t)) syncNav();
        saveSession();
        pushHistory(url, t.title);
        sound.click();
      });
      wv.addEventListener('page-title-updated', (e) => {
        t.title = e.title || t.title;
        renderTabs();
        if (isActive(t)) syncNav();
      });
      wv.addEventListener('did-navigate', (e) => {
        t.url = e.url;
        t.renderedUrl = e.url;
        if (isActive(t)) {
          urlInp.value = e.url;
          lockEl.classList.toggle('secure', e.url.startsWith('https:'));
        }
        saveSession();
      });
      wv.addEventListener('did-navigate-in-page', (e) => {
        t.url = e.url;
        t.renderedUrl = e.url;
        if (isActive(t)) urlInp.value = e.url;
        saveSession();
      });
      wv.addEventListener('did-fail-load', (e) => {
        if (settled || e.errorCode === -3) return;
        settled = true;
        t.mode = 'blocked'; t.loading = false; renderTabs();
        if (isActive(t)) showBlocked(url, `Код ${e.errorCode}: ${e.errorDescription || 'ошибка загрузки'}`);
      });

      const grow = setInterval(() => {
        const w = parseFloat(prog.style.width);
        if (w < 85) prog.style.width = (w + 8) + 'px';
      }, 200);
      setTimeout(() => clearInterval(grow), 8000);
      return;
    }

    /* Обычный браузер — iframe */
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.src = url;
    t.wv = f;
    host.appendChild(f);

    let settled = false;
    const grow = setInterval(() => {
      const w = parseFloat(prog.style.width);
      if (w < 88) prog.style.width = (w + 9) + 'px';
    }, 220);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(grow);
      t.mode = 'blocked'; t.loading = false; renderTabs();
      if (isActive(t)) showBlocked(url, 'Сайт не ответил за 7 секунд — обычно это запрет на встраивание.');
    }, 7000);

    f.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearInterval(grow);
      prog.style.width = '100%';
      setTimeout(() => prog.remove(), 320);
      t.loading = false;
      t.title = hostOf(url);
      renderTabs();
      if (isActive(t)) syncNav();
      pushHistory(url, t.title);
      sound.click();
    };
    f.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearInterval(grow);
      t.mode = 'blocked'; t.loading = false; renderTabs();
      if (isActive(t)) showBlocked(url, 'Браузер отклонил загрузку страницы в окне.');
    };
    void force;
  }

  /* ── Режим чтения (рендерим в host вкладки) ─────────────────────── */
  async function showReader(url) {
    const t = cur();
    const host = ensureHost(t);
    activateHost(t);

    // кэш
    if (t.renderedMode === 'reader' && t.renderedUrl === url && !t._readerForce) {
      return true;
    }
    t._readerForce = false;

    host.innerHTML = `
      <div class="br-reader"><div class="rd-inner">
        <div class="skel" style="height:30px;width:70%;margin-bottom:14px"></div>
        <div class="skel" style="height:13px;margin-bottom:9px"></div>
        <div class="skel" style="height:13px;margin-bottom:9px"></div>
        <div class="skel" style="height:13px;width:85%"></div>
      </div></div>`;

    const res = await readerFor(url)?.load?.() ?? null;
    if (!res || !res.ok) {
      if (res?.error) notify.warn('Режим чтения не сработал', res.error);
      host.innerHTML = '';
      t.renderedMode = null;
      return false;
    }

    t.mode = 'reader';
    t.renderedMode = 'reader';
    t.renderedUrl = url;
    t.title = res.title || hostOf(url);

    host.innerHTML = '';
    const box = h(`
      <div class="br-reader"><div class="rd-inner">
        <h1>${esc(res.title || '')}</h1>
        <div class="rd-meta">${esc(res.meta || hostOf(url))} · режим чтения${res.via === 'proxy' ? ' · через прокси' : ''}</div>
        <div class="rd-content"></div>
      </div></div>`);
    box.querySelector('.rd-content').innerHTML = res.html;
    box.querySelectorAll('a[href]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const href = a.getAttribute('href');
        if (!href) return;
        try { navigate(new URL(href, url).href); } catch {}
      };
    });
    host.appendChild(box);
    renderTabs(); syncNav();
    await pushHistory(url, t.title);
    return true;
  }

  /* ── Заблокировано ──────────────────────────────────────────────── */
  function showBlocked(url, extra = '') {
    const t = cur();
    const host = ensureHost(t);
    activateHost(t);
    t.renderedUrl = url;
    t.renderedMode = 'blocked';

    const host_ = hostOf(url);
    host.innerHTML = '';
    const box = h(`
      <div class="br-block">
        <div class="ic">${icon('shield')}</div>
        <h3>${esc(host_)} запрещает открытие в окне</h3>
        <p>Сайт присылает заголовок <code>X-Frame-Options</code>. Это защита от встраивания.${extra ? ' ' + esc(extra) : ''}</p>
        <div class="acts">
          <button class="btn primary" data-a="ext">${icon('external')}<span>Открыть в системном браузере</span></button>
          <button class="btn" data-a="read">${icon('fileText')}<span>Режим чтения</span></button>
          <button class="btn" data-a="copy">${icon('copy')}<span>Скопировать ссылку</span></button>
        </div>
      </div>`);
    box.querySelector('[data-a="ext"]').onclick = () => net.openExternal(url);
    box.querySelector('[data-a="read"]').onclick = async () => {
      t._readerForce = true;
      const ok = await showReader(url);
      if (!ok) notify.warn('Не получилось прочитать', net.proxy()
        ? 'Прокси не отдал содержимое.'
        : 'Нужен свой прокси — Настройки → Сеть.');
    };
    box.querySelector('[data-a="copy"]').onclick = () => {
      import('../services/clipboard.js').then(({ default: cb }) => {
        cb.set(url);
        notify.success('Ссылка в буфере ОС', url, { timeout: 2000 });
      });
    };
    host.appendChild(box);
    syncNav();
  }

  /* ── Стартовая страница ─────────────────────────────────────────── */
  function showStart() {
    const t = cur();
    const host = ensureHost(t);
    activateHost(t);
    t.renderedMode = 'start';
    t.renderedUrl = null;

    host.innerHTML = '';
    const box = h(`
      <div class="br-start">
        <div class="br-brand">
          <svg viewBox="0 0 64 64" class="br-logo" aria-hidden="true">
            <defs>
              <linearGradient id="nsA" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#a855f7"/>
              </linearGradient>
              <linearGradient id="nsB" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stop-color="#ec4899"/><stop offset="1" stop-color="#6366f1"/>
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="28" fill="url(#nsA)" opacity=".1"/>
            <circle cx="32" cy="32" r="20" fill="none" stroke="url(#nsA)" stroke-width="2"/>
            <path d="M22 42 L22 22 L32 32 L42 22 L42 42" fill="none"
                  stroke="url(#nsB)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="32" cy="32" r="2.6" fill="url(#nsA)"/>
          </svg>
          <div class="br-name">Nova<b>Search</b></div>
        </div>
        <form class="br-search">
          <span class="ic">${icon('search')}</span>
          <input class="fld" placeholder="Найти в Википедии, Hacker News, MDN или открыть адрес" spellcheck="false" aria-label="Поиск">
          <button class="btn primary" type="submit">Найти</button>
        </form>
        <div class="br-chips">
          <button type="button" data-q="wiki">Википедия</button>
          <button type="button" data-q="hn">Hacker News</button>
          <button type="button" data-q="mdn">MDN</button>
          <button type="button" data-q="github">GitHub API</button>
        </div>
        <div class="br-tiles"></div>
        <div class="br-recent"></div>
      </div>`);

    const tiles = box.querySelector('.br-tiles');
    for (const t2 of START_TILES) {
      const b = h(`
        <button class="br-tile" title="${esc(t2.url)}">
          <span class="fv" style="background:${t2.c}">${esc(t2.name[0])}</span>
          <span class="nm">${esc(t2.name)}</span>
          <span class="md">${IS_ELECTRON ? 'В окне' : esc(t2.mode)}</span>
        </button>`);
      b.onclick = () => navigate(t2.url);
      tiles.appendChild(b);
    }

    const form = box.querySelector('form');
    const inp = form.querySelector('input');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = inp.value.trim();
      if (!q) return;
      // Если похоже на URL — открываем
      if (/^(https?:\/\/|[\w-]+\.[\w-]+)/.test(q)) {
        navigate(norm(q));
        return;
      }
      const results = await searchWiki(q);
      if (!results.length) {
        notify.warn('Ничего не нашлось', `По запросу «${q}» Википедия ничего не вернула.`);
        return;
      }
      showSearchResults(q, results);
    };

    // чипсы — прямые ссылки
    box.querySelectorAll('.br-chips button').forEach((b) => {
      b.onclick = () => {
        const map = {
          wiki: 'https://ru.wikipedia.org/',
          hn: 'https://news.ycombinator.com/',
          mdn: 'https://developer.mozilla.org/ru/',
          github: 'https://api.github.com/zen',
        };
        navigate(map[b.dataset.q]);
      };
    });

    // недавнее и закладки
    if (marks.length || history.length) {
      const rec = h('<div class="br-recent-list" style="width:min(620px,100%)"></div>');
      if (marks.length) {
        rec.appendChild(h(`<div class="br-sec-head">Закладки</div>`));
        marks.slice(0, 4).forEach((m) => {
          const r = h(`<button class="sm-row"><span class="glyph" style="background:var(--accent)">${icon('bookmark')}</span><span class="meta"><span class="nm">${esc(m.title)}</span><span class="sub">${esc(m.url)}</span></span></button>`);
          r.onclick = () => navigate(m.url);
          rec.appendChild(r);
        });
      }
      if (history.length) {
        rec.appendChild(h(`<div class="br-sec-head">Недавнее</div>`));
        history.slice(0, 4).forEach((x) => {
          const r = h(`<button class="sm-row"><span class="glyph" style="background:var(--bg-4)">${icon('history')}</span><span class="meta"><span class="nm">${esc(x.title)}</span><span class="sub">${esc(x.url)} · ${esc(fmtAgo(x.at))}</span></span></button>`);
          r.onclick = () => navigate(x.url);
          rec.appendChild(r);
        });
      }
      box.appendChild(rec);
    }

    host.appendChild(box);
    syncNav();
    // фокус в поиск
    setTimeout(() => inp.focus(), 40);
  }

  function showSearchResults(q, results) {
    const t = cur();
    const host = ensureHost(t);
    activateHost(t);
    t.title = `Поиск: ${q}`;
    t.mode = 'search';
    t.renderedMode = 'search';

    host.innerHTML = '';
    const box = h(`<div class="br-reader"><div class="rd-inner"><h1>Результаты: ${esc(q)}</h1><div class="rd-meta">Википедия · ${results.length} совпадений</div></div></div>`);
    const inner = box.querySelector('.rd-inner');
    results.forEach((r) => {
      const item = h(`
        <button class="sm-row" style="margin-bottom:4px">
          <span class="glyph" style="background:#94a3b8">${icon('fileText')}</span>
          <span class="meta"><span class="nm">${esc(r.title)}</span><span class="sub" style="white-space:normal">${esc(r.snippet)}</span></span>
        </button>`);
      item.onclick = () => navigate(r.url);
      inner.appendChild(item);
    });
    host.appendChild(box);
    renderTabs(); syncNav();
  }

  function showHistory() {
    const t = cur();
    const host = ensureHost(t);
    activateHost(t);
    t.title = 'История'; t.mode = 'history'; t.renderedMode = 'history';

    host.innerHTML = '';
    if (!history.length) {
      host.appendChild(emptyState({ icon: 'history', title: 'История пуста', text: 'Открой любую страницу — она появится здесь.' }));
      renderTabs(); return;
    }
    const box = h(`<div class="br-reader"><div class="rd-inner"><h1>История</h1><div class="rd-meta">${history.length} записей</div></div></div>`);
    const inner = box.querySelector('.rd-inner');
    history.forEach((x) => {
      const r = h(`<button class="sm-row" style="margin-bottom:3px"><span class="glyph" style="background:var(--bg-4)">${icon('globe')}</span><span class="meta"><span class="nm">${esc(x.title)}</span><span class="sub">${esc(x.url)} · ${esc(fmtAgo(x.at))}</span></span></button>`);
      r.onclick = () => navigate(x.url);
      inner.appendChild(r);
    });
    host.appendChild(box);
    renderTabs(); syncNav();
  }

  function showMarks() {
    const t = cur();
    const host = ensureHost(t);
    activateHost(t);
    t.title = 'Закладки'; t.mode = 'marks'; t.renderedMode = 'marks';

    host.innerHTML = '';
    if (!marks.length) {
      host.appendChild(emptyState({ icon: 'bookmark', title: 'Закладок нет', text: 'Открой страницу и нажми флажок.' }));
      renderTabs(); return;
    }
    const box = h(`<div class="br-reader"><div class="rd-inner"><h1>Закладки</h1><div class="rd-meta">${marks.length} шт.</div></div></div>`);
    const inner = box.querySelector('.rd-inner');
    marks.forEach((m, i) => {
      const r = h(`<button class="sm-row" style="margin-bottom:3px"><span class="glyph" style="background:var(--accent)">${icon('bookmark')}</span><span class="meta"><span class="nm">${esc(m.title)}</span><span class="sub">${esc(m.url)}</span></span></button>`);
      r.onclick = () => navigate(m.url);
      r.oncontextmenu = (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [{
          label: 'Удалить закладку', icon: 'trash', danger: true,
          onClick: async () => { marks.splice(i, 1); await settings.set('brMarks', marks); showMarks(); },
        }]);
      };
      inner.appendChild(r);
    });
    host.appendChild(box);
    renderTabs(); syncNav();
  }

  /* ── Диспетчер вида ─────────────────────────────────────────────── */
  function renderView() {
    const t = cur();
    syncNav();

    if (!t.url || t.mode === 'start') { showStart(); return; }
    if (t.mode === 'blocked') { showBlocked(t.url); return; }
    if (t.mode === 'reader') { showReader(t.url); return; }
    if (t.mode === 'search') {
      // результаты поиска уже отрисованы в host — просто активируем
      activateHost(t);
      return;
    }
    if (t.mode === 'history') { showHistory(); return; }
    if (t.mode === 'marks') { showMarks(); return; }
    showFrame(t.url, false);
  }

  /* ── Сохранение страницы ────────────────────────────────────────── */
  async function savePage() {
    const t = cur();
    if (!t.url) return;
    const rd = t.host?.querySelector('.rd-content');
    const text = rd ? rd.innerText : `Страница: ${t.url}\n\nСодержимое фрейма недоступно.`;
    const name = (t.title || 'страница').replace(/[/\\:*?"<>|]/g, '-').slice(0, 60) + '.txt';
    try {
      const savedPath = await net.saveBlob(text, name, 'text/plain;charset=utf-8');
      notify.success('Страница сохранена в ОС', savedPath, {
        actions: [{ label: 'Открыть', primary: true, onClick: () => registry.launch('editor', { path: savedPath }) }],
      });
    } catch (e) { notify.error('Не удалось сохранить', e.message); }
  }

  /* ── Кнопки навигации ───────────────────────────────────────────── */
  root.querySelector('[data-a="back"]').onclick = () => {
    const t = cur();
    if (t.sp > 0) { t.sp--; navigate(t.stack[t.sp], { push: false }); }
  };
  root.querySelector('[data-a="fwd"]').onclick = () => {
    const t = cur();
    if (t.sp < t.stack.length - 1) { t.sp++; navigate(t.stack[t.sp], { push: false }); }
  };
  root.querySelector('[data-a="reload"]').onclick = () => {
    const t = cur();
    if (t.url) navigate(t.url, { push: false, force: true });
  };
  root.querySelector('[data-a="home"]').onclick = () => {
    const t = cur();
    destroyHost(t);
    t.url = null; t.title = 'Новая вкладка'; t.mode = 'start';
    t.stack = []; t.sp = -1;
    t.renderedUrl = null; t.renderedMode = null;
    renderTabs(); renderView();
  };
  root.querySelector('[data-a="reader"]').onclick = () => {
    const t = cur();
    if (!t.url) { notify.info('Сначала открой страницу', 'Введи адрес.'); return; }
    t._readerForce = true;
    navigate(t.url, { push: false, forceReader: true });
  };
  root.querySelector('[data-a="ext"]').onclick = () => {
    const t = cur();
    if (!t.url) return;
    net.openExternal(t.url);
  };
  root.querySelector('[data-a="mark"]').onclick = async () => {
    const t = cur();
    if (!t.url) return;
    const i = marks.findIndex((m) => m.url === t.url);
    if (i >= 0) { marks.splice(i, 1); notify.info('Закладка убрана', t.title, { timeout: 1800, silent: true }); }
    else { marks.unshift({ url: t.url, title: t.title }); notify.success('В закладках', t.title, { timeout: 1800, silent: true }); }
    await settings.set('brMarks', marks);
    syncNav();
  };
  root.querySelector('[data-a="menu"]').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left - 150, r.bottom + 4, [
      { label: 'Новая вкладка', icon: 'plus', shortcut: 'Ctrl+T', onClick: () => newTab() },
      'sep',
      { label: `История (${history.length})`, icon: 'history', onClick: showHistory },
      { label: `Закладки (${marks.length})`, icon: 'bookmark', onClick: showMarks },
      'sep',
      { label: 'Сохранить страницу в ОС', icon: 'save', onClick: savePage },
      { label: 'Открыть в системном браузере', icon: 'external', onClick: () => cur().url && net.openExternal(cur().url) },
      'sep',
      { label: 'Очистить историю', icon: 'trash', danger: true, onClick: async () => { history = []; await settings.set('brHistory', []); notify.info('История очищена', ''); } },
    ]);
  };

  urlInp.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const u = norm(urlInp.value);
      if (u) navigate(u);
    }
    if (e.key === 'Escape') { urlInp.value = cur()?.url || ''; urlInp.blur(); }
  };
  urlInp.onfocus = () => urlInp.select();

  /* ── Горячие клавиши ────────────────────────────────────────────── */
  const onKey = (e) => {
    if (!win.isFocused()) return;
    if (e.key === 't' && e.ctrlKey) { e.preventDefault(); newTab(); }
    if (e.key === 'w' && e.ctrlKey) { e.preventDefault(); closeTab(active); }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); urlInp.focus(); }
    if (e.key === 'r' && e.ctrlKey) { e.preventDefault(); const t = cur(); if (t.url) navigate(t.url, { push: false, force: true }); }
    if (e.key === 'Tab' && e.ctrlKey) {
      e.preventDefault();
      active = (active + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
      renderTabs(); renderView();
    }
    if (/^[1-9]$/.test(e.key) && e.altKey) {
      const i = +e.key - 1;
      if (tabs[i]) { e.preventDefault(); switchTo(i); }
    }
  };
  document.addEventListener('keydown', onKey);
  win.onCleanup(() => {
    document.removeEventListener('keydown', onKey);
    saveSession();
    // чистим webview'ы
    for (const t of tabs) { try { t.wv?.stop?.(); } catch {} }
  });

  /* ── Старт ──────────────────────────────────────────────────────── */
  const savedSession = settings.get('brSession', null);
  const sessionFresh = savedSession?.tabs?.length && (Date.now() - (savedSession.at || 0) < 7 * 24 * 3600 * 1000);

  if (args?.url) {
    newTab(args.url);
  } else if (sessionFresh) {
    for (const t of savedSession.tabs) {
      tabs.push({
        url: t.url,
        title: t.title || 'Загрузка…',
        stack: [t.url], sp: 0,
        mode: 'frame', loading: false,
        host: null, wv: null,
        renderedUrl: null, renderedMode: null,
      });
    }
    active = Math.min(savedSession.active || 0, tabs.length - 1);
    renderTabs();
    // рендерим только активную вкладку — остальные подгрузятся при переключении
    renderView();
    // ленивая подгрузка остальных — по idle
    const rest = tabs.filter((_, i) => i !== active);
    (async () => {
      for (const t of rest) {
        try {
          // сохраняем текущий активный указатель
          const keep = active;
          active = tabs.indexOf(t);
          await new Promise((r) => requestIdleCallback ? requestIdleCallback(r, { timeout: 800 }) : setTimeout(r, 200));
          if (t.url && t.mode === 'frame') showFrame(t.url, false);
          active = keep;
          activateHost(tabs[keep]);
        } catch {}
      }
    })();
  } else {
    newTab();
  }
}

export default function register() {
  registry.register({
    id: 'browser', name: 'Браузер', icon: 'globe',
    color: 'linear-gradient(135deg,#0ea5e9,#6366f1)',
    width: 940, height: 620, minWidth: 560, minHeight: 360,
    category: 'Сеть', desc: 'Вкладки, история, закладки, режим чтения',
    keywords: ['интернет','web','сайт','browser','википедия','nova'],
    mount,
  });
}