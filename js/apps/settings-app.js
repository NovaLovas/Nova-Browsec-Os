/* settings-app.js — настройки: оформление, сеть, пользователи, система, о системе. */

import bus from '../kernel/bus.js';
import db, { settings } from '../kernel/db.js';
import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import registry from '../shell/registry.js';
import desktop, { WALLPAPERS, ACCENTS } from '../shell/desktop.js';
import taskbar from '../shell/taskbar.js';
import net from '../services/net.js';
import sound from '../services/sound.js';
import notify from '../services/notify.js';
import icon from '../ui/icons.js';
import { h, esc, fmtSize, prompt, confirm, alert as dlgAlert } from '../ui/dom.js';

const TABS = [
  { id: 'appearance', name: 'Оформление', icon: 'palette' },
  { id: 'desktopTab', name: 'Рабочий стол', icon: 'monitor' },
  { id: 'sound',      name: 'Звук',        icon: 'volume' },
  { id: 'network',    name: 'Сеть',        icon: 'globe' },
  { id: 'users',      name: 'Пользователи',icon: 'users' },
  { id: 'storage',    name: 'Хранилище',   icon: 'database' },
  { id: 'about',      name: 'О системе',   icon: 'info' },
];

function row({ nm, sub, ctl }) {
  const el = h(`<div class="st-row"><div class="tx"><div class="nm">${esc(nm)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="ctl"></div></div>`);
  if (ctl) el.querySelector('.ctl').appendChild(ctl);
  return el;
}

function toggle(checked, onChange) {
  const b = h(`<button class="sw" role="switch" aria-checked="${checked}"></button>`);
  b.onclick = async () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    await onChange(v);
    sound.click();
  };
  return b;
}

function select(options, value, onChange) {
  const s = h(`<select class="fld" style="width:auto;min-width:130px">${options.map((o) => `<option value="${esc(o.v)}" ${o.v === value ? 'selected' : ''}>${esc(o.n)}</option>`).join('')}</select>`);
  s.onchange = () => onChange(s.value);
  return s;
}

function mount(root, win, args) {
  let tab = args?.tab || 'appearance';

  root.innerHTML = `
    <div class="app-row">
      <div class="side">
        <div class="side-h">Настройки</div>
        <div class="tabs" style="flex:1;overflow-y:auto;padding-bottom:8px"></div>
      </div>
      <div class="pane"><div class="pad"></div></div>
    </div>`;

  const tabsEl = root.querySelector('.tabs');
  const pad = root.querySelector('.pad');

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const t of TABS) {
      const b = h(`<button class="side-i ${tab === t.id ? 'on' : ''}">${icon(t.icon)}<span class="nm">${esc(t.name)}</span></button>`);
      b.onclick = () => { tab = t.id; renderTabs(); renderBody(); };
      tabsEl.appendChild(b);
    }
  }

  function renderBody() {
    pad.innerHTML = '';
    const t = TABS.find((x) => x.id === tab);
    win.setTitle(`Настройки — ${t?.name || ''}`);
    ({
      appearance: paneAppearance, desktopTab: paneDesktop, sound: paneSound,
      network: paneNetwork, users: paneUsers, storage: paneStorage, about: paneAbout,
    })[tab]?.(pad);
  }

  /* ── оформление ───────────────────────────────────────── */
  function paneAppearance(c) {
    const sec = h(`<div class="st-sec"><h3>Тема</h3><div class="dsc">Тёмная, светлая или по настройке системы.</div></div>`);
    const theme = settings.get('theme', 'dark');
    sec.appendChild(row({
      nm: 'Режим темы', sub: 'Авто следит за настройкой операционной системы',
      ctl: select([{ v: 'dark', n: 'Тёмная' }, { v: 'light', n: 'Светлая' }, { v: 'auto', n: 'Авто' }], theme, async (v) => {
        await settings.set('theme', v); desktop.applyTheme(v); sound.click();
      }),
    }));
    c.appendChild(sec);

    const asec = h(`<div class="st-sec"><h3>Акцентный цвет</h3><div class="dsc">Влияет на кнопки, выделение и подсветку окон.</div></div>`);
    const arow = h('<div class="ac-row"></div>');
    const curAccent = settings.get('accent', 'indigo');
    for (const a of ACCENTS) {
      const d = h(`<button class="ac-dot ${a.id === curAccent ? 'on' : ''}" style="background:${a.c}" title="${a.id}" aria-label="${a.id}"></button>`);
      d.onclick = async () => {
        await settings.set('accent', a.id);
        desktop.applyAccent(a.id);
        arow.querySelectorAll('.ac-dot').forEach((x) => x.classList.remove('on'));
        d.classList.add('on');
        sound.click();
      };
      arow.appendChild(d);
    }
    asec.appendChild(arow);
    c.appendChild(asec);

    const wsec = h(`<div class="st-sec"><h3>Обои</h3><div class="dsc">Градиенты рисуются на CSS — не грузятся из сети и работают офлайн.</div></div>`);
    const grid = h('<div class="wp-grid"></div>');
    const curWp = settings.get('wallpaper', 'nebula');
    for (const w of WALLPAPERS) {
      const b = h(`<button class="wp-item ${w.id === curWp ? 'on' : ''}" title="${esc(w.name)}"><span class="nm">${esc(w.name)}</span></button>`);
      b.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg-2');
      b.classList.add('wp-preview');
      // превью — тот же градиент, что и обои
      const probe = document.createElement('div');
      probe.className = 'wp-' + w.id;
      probe.style.cssText = 'position:absolute;inset:0';
      b.prepend(probe);
      b.onclick = async () => {
        await settings.set('wallpaper', w.id);
        desktop.applyWallpaper(w.id);
        grid.querySelectorAll('.wp-item').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        sound.click();
      };
      grid.appendChild(b);
    }
    wsec.appendChild(grid);
    wsec.appendChild(h('<div style="height:10px"></div>'));
    const upl = h(`<button class="btn sm">${icon('image')}<span>Своя картинка из файла</span></button>`);
    const fi = h('<input type="file" accept="image/*" hidden>');
    upl.onclick = () => fi.click();
    fi.onchange = async () => {
      const f = fi.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = async () => {
        await settings.set('wallpaper', 'custom:' + fr.result);
        desktop.applyWallpaper('custom:' + fr.result);
        notify.success('Обои обновлены', f.name);
      };
      fr.readAsDataURL(f);
    };
    wsec.appendChild(upl); wsec.appendChild(fi);
    c.appendChild(wsec);
  }

  /* ── рабочий стол ─────────────────────────────────────── */
  function paneDesktop(c) {
    const sec = h(`<div class="st-sec"><h3>Рабочий стол</h3><div class="dsc">Иконки, яркость, поведение окон.</div></div>`);
    sec.appendChild(row({
      nm: 'Яркость экрана', sub: 'Программное затемнение — это CSS-фильтр, не аппаратная яркость',
      ctl: (() => {
        const wrap = h('<div style="display:flex;align-items:center;gap:9px;width:180px"></div>');
        const v = settings.get('brightness', 100);
        const r = h(`<input class="rng" type="range" min="30" max="100" value="${v}" aria-label="Яркость">`);
        const lb = h(`<span style="font-size:11px;color:var(--fg-3);width:34px">${v}%</span>`);
        r.oninput = async () => { lb.textContent = r.value + '%'; await settings.set('brightness', +r.value); taskbar.applyBrightness(+r.value); };
        wrap.append(r, lb);
        return wrap;
      })(),
    }));
    sec.appendChild(row({
      nm: 'Сбросить положение иконок', sub: 'Вернуть иконки в сетку по умолчанию',
      ctl: (() => { const b = h('<button class="btn sm">Сбросить</button>'); b.onclick = () => { desktop.resetIcons(); notify.success('Иконки выровнены', ''); }; return b; })(),
    }));
    sec.appendChild(row({
      nm: 'Восстанавливать сессию', sub: 'После перезагрузки страницы снова открыть те же приложения',
      ctl: toggle(settings.get('restoreSession', true), (v) => settings.set('restoreSession', v)),
    }));
    c.appendChild(sec);
  }

  /* ── звук ─────────────────────────────────────────────── */
  function paneSound(c) {
    const sec = h(`<div class="st-sec"><h3>Звук</h3><div class="dsc">Все звуки синтезируются через Web Audio — внешних файлов нет.</div></div>`);
    sec.appendChild(row({
      nm: 'Громкость',
      ctl: (() => {
        const wrap = h('<div style="display:flex;align-items:center;gap:9px;width:180px"></div>');
        const r = h(`<input class="rng" type="range" min="0" max="100" value="${Math.round(sound.volume * 100)}" aria-label="Громкость">`);
        const lb = h(`<span style="font-size:11px;color:var(--fg-3);width:34px">${Math.round(sound.volume * 100)}%</span>`);
        r.oninput = async () => { lb.textContent = r.value + '%'; await sound.setVolume(+r.value / 100); taskbar.renderTray(); };
        r.onchange = () => sound.notify();
        wrap.append(r, lb);
        return wrap;
      })(),
    }));
    sec.appendChild(row({
      nm: 'Без звука', ctl: toggle(sound.muted, async (v) => { await sound.setMuted(v); taskbar.renderTray(); }),
    }));
    sec.appendChild(row({
      nm: 'Проверить звуки', sub: 'Щелчок, уведомление, ошибка, успех',
      ctl: (() => {
        const wrap = h('<div style="display:flex;gap:6px"></div>');
        [['Клик', 'click'], ['Уведом.', 'notify'], ['Ошибка', 'error'], ['Успех', 'success']].forEach(([n, m]) => {
          const b = h(`<button class="btn sm">${esc(n)}</button>`);
          b.onclick = () => sound[m]();
          wrap.appendChild(b);
        });
        return wrap;
      })(),
    }));
    c.appendChild(sec);
  }

  /* ── сеть ─────────────────────────────────────────────── */
  function paneNetwork(c) {
    const s = net.status();
    const sec = h(`
      <div class="st-sec">
        <h3>Сеть</h3>
        <div class="dsc">Браузер не даёт открыть произвольный сайт напрямую: мешает CORS. Свой прокси решает это честно — код воркера лежит в <code>worker/proxy.js</code>.</div>
      </div>`);

    sec.appendChild(row({
      nm: 'Состояние', sub: navigator.connection?.effectiveType ? `Тип связи: ${navigator.connection.effectiveType}` : '',
      ctl: h(`<span class="tag ${s.online ? 'ok' : 'err'}">${s.online ? 'Подключено' : 'Нет сети'}</span>`),
    }));

    const proxyRow = row({
      nm: 'URL прокси', sub: 'Например <code>https://my-proxy.workers.dev/</code>. Прокси должен принимать <code>?url=</code>',
      ctl: (() => {
        const wrap = h('<div style="display:flex;gap:6px;align-items:center"></div>');
        const inp = h(`<input class="fld" style="width:230px" placeholder="https://…workers.dev/" value="${esc(s.proxy)}">`);
        const b = h('<button class="btn sm primary">Сохранить</button>');
        b.onclick = async () => {
          await net.setProxy(inp.value);
          notify.success('Прокси сохранён', net.proxy() || 'выключен');
          taskbar.renderTray();
        };
        wrap.append(inp, b);
        return wrap;
      })(),
    });
    sec.appendChild(proxyRow);

    sec.appendChild(row({
      nm: 'Проверить связь', sub: 'Реальные HTTP-запросы к api.github.com',
      ctl: (() => {
        const wrap = h('<div style="display:flex;gap:8px;align-items:center"></div>');
        const out = h('<span style="font-size:11.5px;color:var(--fg-3)"></span>');
        const b = h(`<button class="btn sm">${icon('zap')}<span>Пинг</span></button>`);
        b.onclick = async () => {
          b.disabled = true; out.textContent = 'проверяю…';
          const r = await net.ping('https://api.github.com/zen', { count: 3 });
          out.innerHTML = r.avg != null
            ? `<span style="color:var(--ok)">${r.avg} мс</span> · потерь ${r.loss}%`
            : '<span style="color:var(--danger)">хост недоступен</span>';
          b.disabled = false;
        };
        wrap.append(b, out);
        return wrap;
      })(),
    }));

    sec.appendChild(row({
      nm: 'Свой IP и провайдер', sub: 'Запрос к ipapi.co — работает без прокси',
      ctl: (() => {
        const wrap = h('<div style="display:flex;gap:8px;align-items:center"></div>');
        const out = h('<span style="font-size:11.5px;color:var(--fg-3);user-select:text"></span>');
        const b = h(`<button class="btn sm">${icon('globe')}<span>Узнать</span></button>`);
        b.onclick = async () => {
          b.disabled = true; out.textContent = 'запрос…';
          try {
            const j = await net.json('https://ipapi.co/json/');
            out.textContent = `${j.ip} · ${j.city || '—'}, ${j.country_name || '—'} · ${j.org || '—'}`;
          } catch (e) { out.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`; }
          b.disabled = false;
        };
        wrap.append(b, out);
        return wrap;
      })(),
    }));
    c.appendChild(sec);

    const isec = h(`
      <div class="st-sec">
        <h3>Что работает без прокси</h3>
        <div class="dsc">Эти API отдают заголовок Access-Control-Allow-Origin, поэтому доступны напрямую.</div>
      </div>`);
    const card = h('<div class="card"></div>');
    [
      ['Погода', 'api.open-meteo.com — приложение «Погода»'],
      ['Википедия', 'wikipedia.org REST API — режим чтения в браузере'],
      ['Hacker News', 'hacker-news.firebaseio.com — лента новостей'],
      ['Курсы валют/крипты', 'api.coingecko.com'],
      ['Свой IP', 'ipapi.co'],
      ['GitHub API', 'api.github.com'],
    ].forEach(([k, v]) => card.appendChild(h(`<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)));
    isec.appendChild(card);
    c.appendChild(isec);

    const bsec = h(`
      <div class="st-sec">
        <h3>Что не откроется в окне браузера</h3>
        <div class="dsc">YouTube, Google, VK, GitHub, Discord, Telegram, Roblox и другие запрещают встраивание заголовком X-Frame-Options. Это нельзя обойти — система предложит открыть их в системном браузере.</div>
      </div>`);
    c.appendChild(bsec);
  }

  /* ── пользователи ─────────────────────────────────────── */
  function paneUsers(c) {
    const cur = users.current();
    const sec = h(`<div class="st-sec"><h3>Пользователи</h3><div class="dsc">Права в файловой системе зависят от владельца и групп.</div></div>`);
    for (const u of users.all()) {
      const r = row({
        nm: u.label + (u.name === cur?.name ? ' (вы)' : ''),
        sub: `${u.name} · группы: ${u.groups.join(', ')} · ${u.hasPass ? 'пароль установлен' : 'без пароля'}${u.root ? ' · root' : ''}`,
        ctl: (() => {
          const b = h(`<button class="btn sm">${icon('lock')}<span>Пароль</span></button>`);
          b.onclick = async () => {
            const p = await prompt({
              title: `Пароль для ${u.label}`,
              message: 'Оставь пустым, чтобы входить без пароля. Пароль хешируется SHA-256 и хранится локально.',
              value: '',
            });
            if (p === null) return;
            await users.setPassword(u.name, p);
            notify.success('Пароль обновлён', p ? u.label : `${u.label} — вход без пароля`);
            renderBody();
          };
          return b;
        })(),
      });
      sec.appendChild(r);
    }
    sec.appendChild(h(`<div class="dsc" style="margin-top:10px">По умолчанию: <code>user</code> без пароля, <code>root</code> с паролем <code>toor</code>, <code>guest</code> без пароля.</div>`));
    c.appendChild(sec);

    const lsec = h(`<div class="st-sec"><h3>Сессия</h3></div>`);
    lsec.appendChild(row({
      nm: 'Заблокировать', sub: 'Вернуться к экрану входа',
      ctl: (() => { const b = h('<button class="btn sm">Заблокировать</button>'); b.onclick = () => bus.emit('session:lock'); return b; })(),
    }));
    c.appendChild(lsec);
  }

  /* ── хранилище ────────────────────────────────────────── */
  function paneStorage(c) {
    const sec = h(`<div class="st-sec"><h3>Хранилище</h3><div class="dsc">Файлы и настройки лежат в IndexedDB этого браузера. Никаких серверов.</div></div>`);
    const card = h('<div class="card"><h4>Использование</h4><div class="body"></div></div>');
    const body = card.querySelector('.body');
    body.innerHTML = '<div class="skel" style="height:16px;margin-bottom:6px"></div><div class="skel" style="height:16px;width:70%"></div>';
    (async () => {
      const { usage, quota } = await db.usage();
      const files = await fs.all();
      const dirs = files.filter((f) => f.type === 'dir').length;
      body.innerHTML = '';
      [
        ['Занято', quota ? `${fmtSize(usage)} из ${fmtSize(quota)} (${Math.round((usage / quota) * 100)}%)` : fmtSize(usage)],
        ['Файлов', String(files.length - dirs)],
        ['Папок', String(dirs)],
        ['Размер ФС', fmtSize(await fs.du('/'))],
      ].forEach(([k, v]) => body.appendChild(h(`<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)));
    })();
    sec.appendChild(card);
    c.appendChild(sec);

    const esec = h(`<div class="st-sec"><h3>Данные</h3><div class="dsc">Ты владелец данных: выгрузи всю систему одной кнопкой.</div></div>`);
    esec.appendChild(row({
      nm: 'Экспорт в JSON', sub: 'Файлы, настройки и структура папок',
      ctl: (() => {
        const b = h(`<button class="btn sm primary">${icon('download')}<span>Выгрузить</span></button>`);
        b.onclick = async () => {
          const files = await fs.all();
          const keys = await db.keys('kv');
          const vals = await db.all('kv');
          const data = {
            version: 1, exported: new Date().toISOString(),
            settings: Object.fromEntries(keys.map((k, i) => [k, vals[i]])),
            files: files.map(({ blobKey, ...f }) => f),
          };
          net.saveBlob(JSON.stringify(data, null, 2), `browsec-os-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
          notify.success('Система выгружена', `${files.length} записей — проверь загрузки`);
        };
        return b;
      })(),
    }));
    esec.appendChild(row({
      nm: 'Импорт из JSON', sub: 'Файлы добавятся к существующим, конфликты перезапишутся',
      ctl: (() => {
        const wrap = h('<div></div>');
        const fi = h('<input type="file" accept="application/json,.json" hidden>');
        const b = h(`<button class="btn sm">${icon('arrowUp')}<span>Загрузить</span></button>`);
        b.onclick = () => fi.click();
        fi.onchange = async () => {
          const f = fi.files[0];
          if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            if (!Array.isArray(data.files)) throw new Error('В файле нет массива files');
            let n = 0;
            for (const node of data.files) {
              if (node.type === 'dir') await fs.mkdir(node.path, { recursive: true, quiet: true });
              else await fs.write(node.path, node.content ?? '', { mime: node.mime, mode: node.mode });
              n++;
            }
            notify.success('Импорт завершён', `Восстановлено ${n} записей`);
            renderBody();
          } catch (e) { notify.error('Импорт не удался', e.message); }
          fi.value = '';
        };
        wrap.append(b, fi);
        return wrap;
      })(),
    }));
    esec.appendChild(row({
      nm: 'Сбросить систему', sub: 'Удалит все файлы, настройки и пользователей. Отменить нельзя.',
      ctl: (() => {
        const b = h(`<button class="btn sm danger">${icon('trash')}<span>Сбросить</span></button>`);
        b.onclick = async () => {
          const ok = await confirm({
            title: 'Сбросить систему?', ok: 'Удалить всё', danger: true,
            message: 'Все файлы, заметки, настройки и пароли будут удалены. Страница перезагрузится.',
          });
          if (!ok) return;
          await db.wipe();
          location.reload();
        };
        return b;
      })(),
    }));
    c.appendChild(esec);
  }

  /* ── о системе ────────────────────────────────────────── */
  function paneAbout(c) {
    const sec = h(`<div class="st-sec"><h3>Browsec OS</h3><div class="dsc">Операционная система в браузере: чистый JavaScript, без фреймворков и сборщиков.</div></div>`);
    const card = h('<div class="card"><h4>Система</h4></div>');
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const secure = isSecureContext;
    [
      ['Версия', '1.0'],
      ['Приложений', String(registry.count())],
      ['Протокол', location.protocol + (isLocal ? ' (localhost)' : '')],
      ['Защищённый контекст', secure ? 'да — камера, буфер обмена и уведомления доступны' : 'нет — нужен http://localhost или HTTPS'],
      ['Браузер', navigator.userAgent.split(') ').pop() || navigator.userAgent.slice(0, 60)],
      ['Ядер CPU', String(navigator.hardwareConcurrency || '—')],
      ['Память устройства', navigator.deviceMemory ? navigator.deviceMemory + ' ГБ' : (navigator.deviceMemory === 0 ? '0' : '—')],
      ['Язык', navigator.language],
      ['Экран', `${screen.width}×${screen.height} · ${devicePixelRatio}x`],
    ].forEach(([k, v]) => card.appendChild(h(`<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)));
    sec.appendChild(card);
    c.appendChild(sec);

    const lim = h(`
      <div class="st-sec">
        <h3>Честные ограничения</h3>
        <div class="dsc">Что браузер физически не даёт сделать — и как система с этим живёт.</div>
      </div>`);
    const lcard = h('<div class="card"></div>');
    [
      ['CORS', 'Прямой запрос к чужому домену блокируется. Обход — только свой прокси.'],
      ['X-Frame-Options', 'Крупные сайты нельзя открыть в окне. Система предлагает системный браузер.'],
      ['Нативные приложения', 'Discord, Telegram, Roblox не могут выполняться внутри вкладки. Магазин качает настоящие установщики на диск.'],
      ['Память процессов', 'Точный расход памяти вкладки браузер не сообщает — в диспетчере оценка.'],
      ['Камера и микрофон', secure ? 'Доступны: контекст защищённый.' : 'Требуют localhost или HTTPS.'],
      ['file://', 'Модули и IndexedDB не работают. Нужен http://localhost.'],
    ].forEach(([k, v]) => lcard.appendChild(h(`<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)));
    lim.appendChild(lcard);
    c.appendChild(lim);

    const dev = h(`<div class="st-sec"><h3>Для разработчиков</h3><div class="dsc">Публичный API доступен как <code>window.OS</code>: fs, processes, windows, notify, events, net, registry. Пример приложения — в README.</div></div>`);
    const b = h(`<button class="btn sm">${icon('code')}<span>Показать пример приложения</span></button>`);
    b.onclick = () => dlgAlert({
      title: 'Своё приложение за 10 строк',
      message: `<pre style="font-family:var(--mono);font-size:11.5px;line-height:1.55;background:var(--bg-2);padding:11px;border-radius:8px;overflow-x:auto;user-select:text">OS.registry.register({
  id: 'hello',
  name: 'Привет',
  icon: 'star',
  category: 'Прочее',
  mount(root, win) {
    root.innerHTML = '&lt;div class="pad"&gt;Привет из своего приложения&lt;/div&gt;';
    win.setTitle('Готово');
  }
});
OS.registry.launch('hello');</pre>
      <p style="margin-top:9px">Вставь этот код в консоль браузера (F12) — приложение появится в меню «Пуск».</p>`,
    });
    dev.appendChild(b);
    c.appendChild(dev);
  }


  renderTabs();
  renderBody();
}

export default function register() {
  registry.register({
    id: 'settings', name: 'Настройки', icon: 'sliders',
    color: 'linear-gradient(135deg,#64748b,#475569)',
    width: 840, height: 560, minWidth: 560, minHeight: 380,
    category: 'Система', desc: 'Тема, обои, сеть, пользователи, хранилище',
    keywords: ['settings','параметры','тема','прокси'],
    singleton: true,
    mount,
  });
}
