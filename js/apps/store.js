/* store.js — магазин NovaOS. Встроенный каталог + установка по URL-манифесту. */

import fs from '../kernel/fs.js';
import bus from '../kernel/bus.js';
import registry from '../shell/registry.js';
import net from '../services/net.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';
import icon from '../ui/icons.js';
import { h, esc, confirm, prompt } from '../ui/dom.js';

const APPS_DIR = '/etc/apps';

/* ── Встроенный каталог (6 мини-приложений) ─────────────────────── */
const CATALOG = [
  {
    id: 'sticky-note', name: 'Стикер', icon: 'notes',
    color: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
    category: 'Работа', desc: 'Простая заметка с автосохранением',
    width: 380, height: 320, keywords: ['стикер','заметка'],
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box;font:13px system-ui}
body{background:#fef3c7;color:#1f2937;height:100vh;display:flex;flex-direction:column}
textarea{flex:1;border:none;outline:none;background:transparent;padding:16px;font:14px/1.5 system-ui;resize:none}
.foot{padding:8px 12px;background:rgba(0,0,0,.05);font-size:11px;color:#78716c;display:flex;justify-content:space-between}
</style></head><body>
<textarea placeholder="Пиши..."></textarea>
<div class="foot"><span>Стикер</span><span class="st">сохранено</span></div>
<script>
const ta=document.querySelector('textarea'),st=document.querySelector('.st');
window.OS?.fs?.then?.(0);
(async()=>{
  const OS=window.OS; if(!OS?.fs) return;
  const path='/home/user/Документы/стикер.txt';
  if(await OS.fs.exists(path)) ta.value=await OS.fs.read(path);
  let t;
  ta.addEventListener('input',()=>{st.textContent='печатаю...';clearTimeout(t);
    t=setTimeout(async()=>{await OS.fs.write(path,ta.value);st.textContent='сохранено'},600)});
})();
<\/script></body></html>`,
  },
  {
    id: 'pomodoro', name: 'Помодоро', icon: 'clock',
    color: 'linear-gradient(135deg,#ef4444,#dc2626)',
    category: 'Утилиты', desc: 'Таймер 25/5 минут',
    width: 340, height: 380, keywords: ['таймер','помодоро'],
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box;font:14px system-ui}
body{background:#0f172a;color:#f1f5f9;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px}
.t{font:200 88px/1 system-ui;letter-spacing:-4px;font-variant-numeric:tabular-nums}
.m{font-size:12px;opacity:.5;text-transform:uppercase;letter-spacing:2px}
.row{display:flex;gap:8px}
button{padding:10px 20px;border:none;border-radius:8px;background:#334155;color:#f1f5f9;font:inherit;cursor:pointer}
button:hover{background:#475569}
button.p{background:#ef4444}button.p:hover{background:#dc2626}
</style></head><body>
<div class="m work">работа</div><div class="t">25:00</div>
<div class="row"><button class="start p">старт</button><button class="pause">пауза</button><button class="reset">сброс</button></div>
<script>
let mode='work',remain=25*60,iv=null,running=false;
const T=document.querySelector('.t'),M=document.querySelector('.m');
const fmt=()=>{const m=Math.floor(remain/60),s=remain%60;return m+':'+String(s).padStart(2,'0')};
const upd=()=>{T.textContent=fmt();M.textContent=mode==='work'?'работа':'перерыв'};
document.querySelector('.start').onclick=()=>{if(running)return;running=true;
  iv=setInterval(()=>{remain--;
    if(remain<=0){clearInterval(iv);running=false;
      try{window.OS?.notify?.success('Помодоро',mode==='work'?'Перерыв 5 минут':'Работа 25 минут')}catch(e){}
      mode=mode==='work'?'break':'work';remain=mode==='work'?25*60:5*60}
    upd()},1000)};
document.querySelector('.pause').onclick=()=>{clearInterval(iv);running=false};
document.querySelector('.reset').onclick=()=>{clearInterval(iv);running=false;remain=mode==='work'?25*60:5*60;upd()};
upd();
<\/script></body></html>`,
  },
  {
    id: 'password-gen', name: 'Генератор паролей', icon: 'shield',
    color: 'linear-gradient(135deg,#10b981,#059669)',
    category: 'Утилиты', desc: 'Криптостойкие пароли',
    width: 420, height: 380, keywords: ['пароль','password','генератор'],
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box;font:13px system-ui}
body{background:#0f172a;color:#f1f5f9;height:100vh;padding:20px;display:flex;flex-direction:column;gap:14px}
.out{background:#1e293b;padding:14px;border-radius:8px;font:600 16px/1.4 monospace;word-break:break-all;min-height:60px;display:flex;align-items:center}
label{display:flex;align-items:center;gap:8px;cursor:pointer}
input[type=range]{flex:1}input[type=checkbox]{accent-color:#10b981}
button{padding:10px;border:none;border-radius:8px;background:#10b981;color:#fff;font:inherit;cursor:pointer}
button:hover{background:#059669}
.len{font-weight:600;min-width:28px;text-align:right}
</style></head><body>
<div class="out">—</div>
<label>Длина <input type="range" min="8" max="64" value="20" class="len-in"><span class="len">20</span></label>
<label><input type="checkbox" class="d" checked>Цифры</label>
<label><input type="checkbox" class="s" checked>Спецсимволы</label>
<button class="gen">Сгенерировать</button>
<script>
const out=document.querySelector('.out'),lenIn=document.querySelector('.len-in'),lenV=document.querySelector('.len');
lenIn.oninput=()=>lenV.textContent=lenIn.value;
function gen(){
  const L='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';let chars=L;
  if(document.querySelector('.d').checked)chars+='0123456789';
  if(document.querySelector('.s').checked)chars+='!@#$%^&*()-_=+[]{}';
  const arr=new Uint32Array(+lenIn.value);crypto.getRandomValues(arr);
  out.textContent=Array.from(arr,c=>chars[c%chars.length]).join('');
}
document.querySelector('.gen').onclick=gen;gen();
<\/script></body></html>`,
  },
  {
    id: 'color-picker', name: 'Цвета', icon: 'palette',
    color: 'linear-gradient(135deg,#8b5cf6,#6366f1)',
    category: 'Утилиты', desc: 'Палитра, HEX/RGB',
    width: 400, height: 460, keywords: ['цвет','палитра'],
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box;font:13px system-ui}
body{background:#0f172a;color:#f1f5f9;height:100vh;padding:20px;display:flex;flex-direction:column;gap:16px}
.prev{height:100px;border-radius:12px;background:#6366f1}
input[type=color]{width:100%;height:60px;border:none;background:transparent;cursor:pointer}
.info{font:600 20px monospace;text-align:center;letter-spacing:1px}
.sub{font-size:12px;color:#94a3b8;text-align:center}
button{padding:12px;border:none;border-radius:8px;background:#6366f1;color:#fff;font:inherit;cursor:pointer}
button:hover{background:#818cf8}
</style></head><body>
<input type="color" value="#6366f1"><div class="prev"></div>
<div class="info hex">#6366F1</div><div class="sub rgb">rgb(99, 102, 241)</div>
<button class="copy">Копировать HEX</button>
<script>
const inp=document.querySelector('input'),prev=document.querySelector('.prev');
const hexEl=document.querySelector('.hex'),rgbEl=document.querySelector('.rgb');
function upd(){const v=inp.value.toUpperCase();prev.style.background=v;hexEl.textContent=v;
  const r=parseInt(v.slice(1,3),16),g=parseInt(v.slice(3,5),16),b=parseInt(v.slice(5,7),16);
  rgbEl.textContent='rgb('+r+', '+g+', '+b+')'}
inp.oninput=upd;upd();
document.querySelector('.copy').onclick=async()=>{
  try{await window.OS?.clipboard?.set(inp.value.toUpperCase());
    window.OS?.notify?.success('Скопировано','HEX в буфере')}catch(e){}};
<\/script></body></html>`,
  },
  {
    id: 'dice', name: 'Кости', icon: 'puzzle',
    color: 'linear-gradient(135deg,#f43f5e,#e11d48)',
    category: 'Игры', desc: 'Бросок кубиков D4–D20',
    width: 380, height: 340, keywords: ['кости','dice','рандом'],
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box;font:13px system-ui}
body{background:#0f172a;color:#f1f5f9;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
.res{font:200 96px/1 system-ui;color:#f43f5e}
.row{display:flex;gap:6px}
button{padding:10px 16px;border:1px solid #334155;border-radius:8px;background:transparent;color:#f1f5f9;font:inherit;cursor:pointer}
button:hover{background:#334155}button.on{background:#f43f5e;border-color:#f43f5e}
.roll{padding:14px 40px;background:#f43f5e;border:none;font-size:16px;font-weight:600}
.roll:hover{background:#e11d48}
</style></head><body>
<div class="res">—</div>
<div class="row"><button data-d="4">D4</button><button data-d="6">D6</button>
<button data-d="8">D8</button><button data-d="10">D10</button>
<button data-d="12">D12</button><button data-d="20" class="on">D20</button></div>
<button class="roll">Бросить</button>
<script>
let sides=20;
document.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{sides=+b.dataset.d;
  document.querySelectorAll('[data-d]').forEach(x=>x.classList.remove('on'));b.classList.add('on')});
document.querySelector('.roll').onclick=()=>{const a=new Uint32Array(1);crypto.getRandomValues(a);
  document.querySelector('.res').textContent=(a[0]%sides)+1};
<\/script></body></html>`,
  },
  {
    id: 'world-clock', name: 'Мировые часы', icon: 'clock',
    color: 'linear-gradient(135deg,#0891b2,#0e7490)',
    category: 'Утилиты', desc: 'Время в разных городах',
    width: 440, height: 480, keywords: ['часы','время','timezone'],
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box;font:13px system-ui}
body{background:#0f172a;color:#f1f5f9;height:100vh;padding:20px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}
h2{font-size:16px;font-weight:600;margin-bottom:6px}
.zone{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#1e293b;border-radius:10px}
.zone .name{flex:1;font-weight:500}
.zone .tz{font-size:10.5px;color:#94a3b8}
.zone .time{font:600 20px/1 system-ui;font-variant-numeric:tabular-nums}
</style></head><body>
<h2>Мировые часы</h2>
<div id="list"></div>
<script>
const zones=['UTC','Europe/Moscow','Europe/London','Europe/Berlin','America/New_York','America/Los_Angeles','Asia/Tokyo','Asia/Shanghai','Australia/Sydney','Asia/Dubai'];
const list=document.getElementById('list');
list.innerHTML=zones.map(z=>'<div class="zone"><div style="flex:1"><div class="name">'+z.split('/').pop().replace(/_/g,' ')+'</div><div class="tz">'+z+'</div></div><div class="time" data-z="'+z+'">--:--</div></div>').join('');
function tick(){const d=new Date();
  list.querySelectorAll('[data-z]').forEach(el=>{
    try{el.textContent=d.toLocaleTimeString('ru-RU',{timeZone:el.dataset.z,hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{el.textContent='—'}})}
tick();setInterval(tick,1000);
<\/script></body></html>`,
  },
];

/* ── Установка пакета ───────────────────────────────────────────── */
async function isInstalled(id) {
  return fs.exists(`${APPS_DIR}/${id}.app`);
}

async function install(pkg, { source = null } = {}) {
  await fs.mkdir(APPS_DIR, { recursive: true, quiet: true });
  const path = `${APPS_DIR}/${pkg.id}.app`;
  const data = {
    id: pkg.id,
    name: pkg.name,
    icon: pkg.icon || 'puzzle',
    color: pkg.color || 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    category: pkg.category || 'Прочее',
    desc: pkg.desc || '',
    width: pkg.width || 500,
    height: pkg.height || 400,
    keywords: pkg.keywords || [],
    html: pkg.html,
    source,
    installed: Date.now(),
    version: pkg.version || 1,
  };
  await fs.write(path, JSON.stringify(data, null, 2), { mime: 'application/json' });
  registerInstalled(data);
  return data;
}

/** Установить из URL-манифеста. */
async function installFromUrl(url) {
  const r = await net.request(url, { proxyFirst: false });
  if (!r.ok) throw new Error(`HTTP ${r.status || '?'}: ${r.message || r.statusText || 'ошибка загрузки'}`);
  const pkg = JSON.parse(r.text);
  if (!pkg.id || !pkg.name) throw new Error('Манифест неполный: нужны id и name');
  if (!pkg.html && pkg.html_url) {
    const r2 = await net.request(pkg.html_url, { proxyFirst: false });
    if (!r2.ok) throw new Error(`html_url: HTTP ${r2.status}`);
    pkg.html = r2.text;
  }
  if (!pkg.html) throw new Error('Манифест не содержит html или html_url');
  if (pkg.html.length > 500_000) throw new Error('HTML слишком большой (>500 КБ)');
  return pkg;
}

/* ── UI ──────────────────────────────────────────────────────────── */
function mount(root, win) {
  let filter = 'Все';

  root.innerHTML = `
    <div class="app">
      <div class="as-hero">
        <h2>Магазин NovaOS</h2>
        <p>Встроенные мини-приложения и установка по URL. Всё хранится в виртуальной ФС — реальный диск не затрагивается.</p>
        <div class="as-url-install">
          <input class="fld as-url-input" placeholder="URL манифеста (https://…/app.json)" spellcheck="false">
          <button class="btn primary as-url-btn">${icon('download')}<span>Установить по ссылке</span></button>
        </div>
      </div>
      <div class="as-cats"></div>
      <div class="as-grid"></div>
    </div>`;

  const catsEl = root.querySelector('.as-cats');
  const grid = root.querySelector('.as-grid');
  const urlInput = root.querySelector('.as-url-input');
  const urlBtn = root.querySelector('.as-url-btn');

  urlBtn.onclick = async () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    urlBtn.disabled = true;
    try {
      const pkg = await installFromUrl(url);
      if (await isInstalled(pkg.id)) {
        const ok = await confirm({
          title: 'Переустановить?', ok: 'Заменить', danger: true,
          message: `<b>${esc(pkg.name)}</b> уже установлено. Заменить на версию из ссылки?`,
        });
        if (!ok) { urlBtn.disabled = false; return; }
      }
      await install(pkg, { source: url });
      sound.success();
      notify.success('Установлено', `${pkg.name} — доступно в Пуск`);
      urlInput.value = '';
      bus.emit('store:installed', { id: pkg.id });
      renderGrid();
    } catch (e) {
      notify.error('Не удалось установить', e.message);
      sound.error();
    }
    urlBtn.disabled = false;
  };

  function renderCats() {
    const cats = ['Все', ...new Set(CATALOG.map((a) => a.category))];
    catsEl.innerHTML = '';
    for (const c of cats) {
      const b = h(`<button class="as-cat ${c === filter ? 'on' : ''}">${esc(c)}</button>`);
      b.onclick = () => { filter = c; renderCats(); renderGrid(); };
      catsEl.appendChild(b);
    }
  }

  async function renderGrid() {
    grid.innerHTML = '';
    const list = CATALOG.filter((a) => filter === 'Все' || a.category === filter);

    // Установленные из URL
    let custom = [];
    try {
      const files = await fs.list(APPS_DIR);
      const catalogIds = new Set(CATALOG.map((c) => c.id));
      for (const f of files) {
        if (f.type !== 'file' || !f.name.endsWith('.app')) continue;
        const id = f.name.replace(/\.app$/, '');
        if (catalogIds.has(id)) continue;
        try {
          const pkg = JSON.parse(String(await fs.read(f.path)));
          custom.push(pkg);
        } catch {}
      }
    } catch {}
    if (filter === 'Все' || filter === 'Установленные') {
      custom.forEach((pkg) => list.push({
        ...pkg, category: 'Установленные', _custom: true,
      }));
    }

    for (const pkg of list) {
      const installed = await isInstalled(pkg.id);
      const card = h(`
        <div class="as-card">
          <div class="ic" style="background:${pkg.color}">${icon(pkg.icon)}</div>
          <div class="bd">
            <div class="nm">${esc(pkg.name)} ${installed ? '<span class="tag ok">установлено</span>' : ''}</div>
            <div class="dv">${esc(pkg.category)}${pkg.source ? ' · из URL' : ''}</div>
            <div class="ds">${esc(pkg.desc || '')}</div>
            <div class="ft">
              <button class="btn sm ${installed ? '' : 'primary'}" data-a="act">
                ${installed ? 'Открыть' : (icon('download') + '<span>Установить</span>')}
              </button>
              ${pkg._custom ? `<button class="btn sm danger" data-a="del" title="Удалить">${icon('trash')}</button>` : ''}
            </div>
          </div>
        </div>`);
      card.querySelector('[data-a="act"]').onclick = async () => {
        if (await isInstalled(pkg.id)) {
          try { registry.launch(pkg.id); }
          catch { notify.error('Не запустилось', 'Попробуй переустановить'); }
        } else {
          await install(pkg);
          sound.success();
          notify.success('Установлено', `${pkg.name} — доступно в Пуск`);
          bus.emit('store:installed', { id: pkg.id });
          renderGrid();
        }
      };
      const del = card.querySelector('[data-a="del"]');
      if (del) del.onclick = async () => {
        const ok = await confirm({
          title: 'Удалить приложение?', ok: 'Удалить', danger: true,
          message: `<b>${esc(pkg.name)}</b> будет удалено.`,
        });
        if (!ok) return;
        await fs.remove(`${APPS_DIR}/${pkg.id}.app`);
        notify.info('Удалено', pkg.name, { timeout: 1800 });
        renderGrid();
      };
      grid.appendChild(card);
    }
  }

  renderCats();
  renderGrid();
  win.setTitle('Магазин приложений');
}

/* ── Регистрация установленных приложений ───────────────────────── */
export function registerInstalled(pkg) {
  if (registry.get(pkg.id)) return;
  registry.register({
    id: pkg.id,
    name: pkg.name,
    icon: pkg.icon || 'puzzle',
    color: pkg.color || 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    category: pkg.category || 'Прочее',
    desc: pkg.desc || '',
    width: pkg.width || 500,
    height: pkg.height || 400,
    keywords: pkg.keywords || [],
    mount(root, win) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'flex:1;min-height:0;display:flex;position:relative';

      const iframe = document.createElement('iframe');
      // ✅ Правильная песочница: без allow-same-origin — приложение в отдельном origin
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
      iframe.style.cssText = 'flex:1;border:none;background:#fff';
      iframe.srcdoc = pkg.html || '<p style="padding:20px;font:14px system-ui">Пустое приложение</p>';
      wrap.appendChild(iframe);
      root.appendChild(wrap);

      // Мост parent ↔ iframe через postMessage
      const bridge = {
        fs: {
          read: async (p) => {
            const full = p.startsWith('/') ? p : `/home/${globalThis.OS?.users?.current()?.name || 'user'}/${p}`;
            const c = await globalThis.OS.fs.read(full);
            return c instanceof Blob ? null : c;
          },
          write: async (p, c) => {
            const full = p.startsWith('/') ? p : `/home/${globalThis.OS?.users?.current()?.name || 'user'}/${p}`;
            return globalThis.OS.fs.write(full, c);
          },
          list: async (p = '/') => globalThis.OS.fs.list(p),
          exists: async (p) => globalThis.OS.fs.exists(p),
        },
        notify: {
          info: (t, m) => globalThis.OS.notify.info(t, m),
          success: (t, m) => globalThis.OS.notify.success(t, m),
          warn: (t, m) => globalThis.OS.notify.warn(t, m),
          error: (t, m) => globalThis.OS.notify.error(t, m),
        },
        clipboard: {
          set: (s) => globalThis.OS.clipboard.set(s),
          get: () => globalThis.OS.clipboard.get(),
        },
        window: {
          setTitle: (t) => win.setTitle(t),
        },
      };

      const onMsg = async (e) => {
        if (e.source !== iframe.contentWindow) return;
        const { id, method, args } = e.data || {};
        if (!id || !method) return;
        try {
          const [ns, fn] = method.split('.');
          const result = await bridge[ns][fn](...(args || []));
          iframe.contentWindow.postMessage({ id, ok: true, result }, '*');
        } catch (err) {
          iframe.contentWindow.postMessage({ id, ok: false, error: err?.message || String(err) }, '*');
        }
      };
      window.addEventListener('message', onMsg);
      win.onCleanup(() => window.removeEventListener('message', onMsg));

      // Инициализация: сообщаем iframe, что родитель готов
      iframe.addEventListener('load', () => {
        iframe.contentWindow.postMessage({ type: 'nova:ready' }, '*');
      });

      win.setTitle(pkg.name);
    },
  });
}

export async function loadInstalledApps() {
  try {
    await fs.mkdir(APPS_DIR, { recursive: true, quiet: true });
    const list = await fs.list(APPS_DIR);
    for (const n of list) {
      if (n.type !== 'file' || !n.name.endsWith('.app')) continue;
      try {
        const pkg = JSON.parse(String(await fs.read(n.path)));
        registerInstalled(pkg);
      } catch (e) {
        console.warn('[store] не смог загрузить', n.path, e);
      }
    }
  } catch {}
}

export default function register() {
  registry.register({
    id: 'store', name: 'Магазин', icon: 'store',
    color: 'linear-gradient(135deg,#ec4899,#8b5cf6)',
    width: 900, height: 600, minWidth: 560, minHeight: 360,
    category: 'Система', desc: 'Установка приложений внутрь ОС',
    keywords: ['appstore','установка','скачать','store','манифест'],
    singleton: true,
    mount,
  });
}