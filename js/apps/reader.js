/* reader.js — режим чтения. Википедия и HN — через официальные API (CORS разрешён).
   Остальное — через свой прокси, если он настроен. */

import net from '../services/net.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/** Разрешённые теги в очищенном HTML. Всё прочее выбрасывается. */
const ALLOWED = new Set(['P','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','PRE','CODE',
  'STRONG','EM','B','I','A','IMG','BR','HR','TABLE','THEAD','TBODY','TR','TH','TD','FIGURE','FIGCAPTION','DL','DT','DD','SPAN','DIV','SECTION','ARTICLE']);
const DROP = new Set(['SCRIPT','STYLE','IFRAME','NOSCRIPT','SVG','FORM','INPUT','BUTTON','NAV','FOOTER','HEADER','ASIDE','VIDEO','AUDIO','CANVAS','OBJECT','EMBED','LINK','META']);

/** Очистить HTML: убрать скрипты, атрибуты-обработчики, оставить безопасное. */
export function sanitize(html, baseUrl = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll([...DROP].join(',')).forEach((n) => n.remove());
  // мусор Википедии
  doc.querySelectorAll('.mw-editsection,.reference,.navbox,.infobox,.metadata,.mbox-small,.hatnote,sup.reference,.mw-empty-elt,.thumbcaption .magnify,table.ambox,.sistersitebox,.noprint')
    .forEach((n) => n.remove());

  const walk = (node) => {
    for (const el of [...node.children]) {
      if (DROP.has(el.tagName)) { el.remove(); continue; }
      if (!ALLOWED.has(el.tagName)) {
        // разворачиваем неизвестный тег, сохраняя содержимое
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.remove();
        continue;
      }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (el.tagName === 'A' && n === 'href') || (el.tagName === 'IMG' && (n === 'src' || n === 'alt'));
        if (!keep) { el.removeAttribute(a.name); continue; }
        if (n === 'href' || n === 'src') {
          let v = a.value.trim();
          if (/^javascript:|^data:(?!image\/)/i.test(v)) { el.removeAttribute(a.name); continue; }
          if (v.startsWith('//')) v = 'https:' + v;
          else if (baseUrl && !/^(https?:|#|mailto:)/i.test(v)) {
            try { v = new URL(v, baseUrl).href; } catch { /* оставим как есть */ }
          }
          el.setAttribute(a.name, v);
        }
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* ── Википедия ────────────────────────────────────────────── */
const wikiInfo = (url) => {
  try {
    const u = new URL(url);
    const m = /^([a-z-]+)\.(m\.)?wikipedia\.org$/i.exec(u.hostname);
    if (!m) return null;
    const lang = m[1];
    let title = null;
    if (u.pathname.startsWith('/wiki/')) title = decodeURIComponent(u.pathname.slice(6));
    else if (u.searchParams.get('title')) title = u.searchParams.get('title');
    const search = u.searchParams.get('search');
    return { lang, title, search };
  } catch { return null; }
};

async function loadWiki(url) {
  const info = wikiInfo(url);
  if (!info) return { ok: false, error: 'Не адрес Википедии' };

  // страница поиска
  if (info.search && !info.title) {
    const list = await searchWiki(info.search, info.lang);
    const html = list.length
      ? '<ul>' + list.map((r) => `<li><a href="${esc(r.url)}">${esc(r.title)}</a><br><span>${esc(r.snippet)}</span></li>`).join('') + '</ul>'
      : '<p>Ничего не найдено.</p>';
    return { ok: true, title: `Поиск: ${info.search}`, meta: `${info.lang}.wikipedia.org`, html };
  }

  const title = info.title || 'Заглавная_страница';
  try {
    const api = `https://${info.lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    const r = await net.request(api, { headers: { Accept: 'text/html' } });
    if (!r.ok) return { ok: false, error: r.message || `HTTP ${r.status}` };
    const clean = sanitize(r.text, `https://${info.lang}.wikipedia.org/wiki/`);
    return {
      ok: true, via: r.via,
      title: decodeURIComponent(title).replace(/_/g, ' '),
      meta: `${info.lang}.wikipedia.org`,
      html: clean,
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Поиск по Википедии. Возвращает [{title, url, snippet}]. */
export async function searchWiki(query, lang = 'ru') {
  try {
    const u = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}`
            + `&srlimit=15&format=json&origin=*`;
    const j = await net.json(u);
    return (j?.query?.search || []).map((s) => ({
      title: s.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
      snippet: String(s.snippet || '').replace(/<[^>]+>/g, '').trim(),
    }));
  } catch { return []; }
}

/* ── Hacker News ──────────────────────────────────────────── */
async function loadHN() {
  try {
    const ids = await net.json('https://hacker-news.firebaseio.com/v0/topstories.json');
    const top = ids.slice(0, 25);
    const items = await Promise.all(top.map((id) =>
      net.json(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)));
    const html = '<ol>' + items.filter(Boolean).map((it) => {
      const link = it.url || `https://news.ycombinator.com/item?id=${it.id}`;
      return `<li><a href="${esc(link)}">${esc(it.title || 'без заголовка')}</a>`
        + `<br><span>${it.score || 0} баллов · ${esc(it.by || '—')} · ${it.descendants || 0} комментариев`
        + ` · <a href="https://news.ycombinator.com/item?id=${it.id}">обсуждение</a></span></li>`;
    }).join('') + '</ol>';
    return { ok: true, title: 'Hacker News — лучшее', meta: 'news.ycombinator.com', html };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ── произвольный сайт через прокси ───────────────────────── */
async function loadGeneric(url) {
  if (!net.proxy()) {
    return { ok: false, error: 'Для этого сайта нужен свой прокси. Настройки → Сеть.' };
  }
  const r = await net.request(url, { proxyFirst: true, headers: { Accept: 'text/html' } });
  if (!r.ok) return { ok: false, error: r.message || `HTTP ${r.status}` };
  const doc = new DOMParser().parseFromString(r.text, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() || url;
  // ищем самый содержательный блок
  const cands = [...doc.querySelectorAll('article,main,[role="main"],.post,.article,.content,#content,body')];
  let best = null, bestLen = 0;
  for (const c of cands) {
    const len = (c.textContent || '').trim().length;
    if (len > bestLen) { best = c; bestLen = len; }
  }
  if (!best || bestLen < 200) return { ok: false, error: 'Не нашёл читаемого текста на странице' };
  return { ok: true, via: r.via, title, meta: (() => { try { return new URL(url).hostname; } catch { return url; } })(), html: sanitize(best.innerHTML, url) };
}

/**
 * Вернуть обработчик режима чтения для URL, либо null если чтение не применимо.
 * Обработчик: { load: () => Promise<{ok, title, meta, html, via}> }
 */
export function readerFor(url) {
  if (wikiInfo(url)) return { kind: 'wiki', load: () => loadWiki(url) };
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'news.ycombinator.com') return { kind: 'hn', load: () => loadHN() };
  } catch { return null; }
  if (net.proxy()) return { kind: 'generic', load: () => loadGeneric(url) };
  return null;
}

export default readerFor;
