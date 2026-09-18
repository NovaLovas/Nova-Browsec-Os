/* shell-cmds.js — команды терминала. Каждая: (args, ctx) => string | Promise<string> */

import fs, { modeStr, parseMode } from '../kernel/fs.js';
import db from '../kernel/db.js';
import users from '../kernel/users.js';
import processes from '../kernel/processes.js';
import registry from '../shell/registry.js';
import wm from '../shell/wm.js';
import net from '../services/net.js';
import notify from '../services/notify.js';
import { fmtSize, fmtDateTime, fmtUptime, pad } from '../ui/dom.js';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
const err = (m) => `<span class="er">${esc(m)}</span>`;
const ok = (m) => `<span class="ok">${esc(m)}</span>`;
const dim = (m) => `<span class="dm">${esc(m)}</span>`;
const hl = (m) => `<span class="hl">${esc(m)}</span>`;

/** Разбор строки в аргументы с учётом кавычек. */
export function tokenize(line) {
  const out = [];
  let cur = '', q = null;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const flags = (args) => {
  const f = new Set(), rest = [];
  for (const a of args) {
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) a.slice(1).split('').forEach((c) => f.add(c));
    else rest.push(a);
  }
  return { f, rest };
};

export const commands = {
  /* ── справка ────────────────────────────────────────────── */
  help: {
    desc: 'список команд или справка по одной: help ls',
    run(args) {
      if (args[0]) {
        const c = commands[args[0]];
        if (!c) return err(`Нет команды «${args[0]}»`);
        return `${hl(args[0])} — ${esc(c.desc)}${c.usage ? `\n  ${dim('использование: ' + c.usage)}` : ''}`;
      }
      const groups = {
        'Файлы':    ['ls','cd','pwd','cat','mkdir','touch','rm','cp','mv','tree','find','stat','head','tail','wc','grep','du','df'],
        'Права':    ['chmod','chown','whoami','sudo','id'],
        'Система':  ['ps','kill','apps','open','windows','date','uptime','clear','history','export','free','reset'],
        'Сеть':     ['curl','ping','wget','ip','proxy','net'],
        'Прочее':   ['echo','notify','theme','help','exit'],
      };
      let out = `${hl('Browsec OS shell')} ${dim('— встроенные команды')}\n\n`;
      for (const [g, list] of Object.entries(groups)) {
        out += `${dim(g)}\n  ${list.filter((c) => commands[c]).join('  ')}\n`;
      }
      out += `\n${dim('help <команда> — подробности. Tab — автодополнение. ↑/↓ — история.')}`;
      return out;
    },
  },

  /* ── файлы ──────────────────────────────────────────────── */
  ls: {
    desc: 'список файлов', usage: 'ls [-la] [путь]',
    async run(args, ctx) {
      const { f, rest } = flags(args);
      const path = fs.resolve(rest[0] || '.', ctx.cwd);
      let list;
      try { list = await fs.list(path); } catch (e) { return err(e.message); }
      if (!f.has('a')) list = list.filter((n) => !n.name.startsWith('.'));
      if (!list.length) return dim('(пусто)');
      if (f.has('l')) {
        const rows = list.map((n) => {
          const d = new Date(n.modified);
          const t = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          const size = (n.type === 'dir' ? '-' : fmtSize(n.size)).padStart(8);
          const name = n.type === 'dir' ? `<span class="hl">${esc(n.name)}/</span>` : esc(n.name);
          return `${modeStr(n)} ${n.owner.padEnd(6)} ${n.group.padEnd(6)} ${size} ${t}  ${name}`;
        });
        return rows.join('\n') + `\n${dim(`итого ${list.length}`)}`;
      }
      return list.map((n) => n.type === 'dir' ? `<span class="hl">${esc(n.name)}/</span>` : esc(n.name)).join('   ');
    },
  },

  cd: {
    desc: 'перейти в папку', usage: 'cd [путь]',
    async run(args, ctx) {
      const target = args[0] || users.home();
      if (target === '-') {
        const prev = ctx.prevCwd || users.home();
        ctx.prevCwd = ctx.cwd; ctx.setCwd(prev);
        return dim(prev);
      }
      const p = fs.resolve(target, ctx.cwd);
      const n = await fs.stat(p);
      if (!n) return err(`Нет такой папки: ${p}`);
      if (n.type !== 'dir') return err(`Не папка: ${p}`);
      if (!fs.can(n, 'x')) return err(`Отказано в доступе: ${p}`);
      ctx.prevCwd = ctx.cwd;
      ctx.setCwd(p);
      return '';
    },
  },

  pwd: { desc: 'текущая папка', run: (a, ctx) => ctx.cwd },

  cat: {
    desc: 'показать содержимое файла', usage: 'cat <файл>',
    async run(args, ctx) {
      if (!args[0]) return err('Укажи файл: cat заметки.txt');
      const out = [];
      for (const a of args) {
        const p = fs.resolve(a, ctx.cwd);
        try {
          const c = await fs.read(p);
          if (c instanceof Blob) { out.push(dim(`(двоичный файл, ${fmtSize(c.size)})`)); continue; }
          out.push(esc(c) || dim('(пустой файл)'));
        } catch (e) { out.push(err(e.message)); }
      }
      return out.join('\n');
    },
  },

  mkdir: {
    desc: 'создать папку', usage: 'mkdir [-p] <имя>',
    async run(args, ctx) {
      const { f, rest } = flags(args);
      if (!rest.length) return err('Укажи имя папки');
      const out = [];
      for (const a of rest) {
        try { await fs.mkdir(fs.resolve(a, ctx.cwd), { recursive: f.has('p') }); out.push(ok(`создано: ${a}`)); }
        catch (e) { out.push(err(e.message)); }
      }
      return out.join('\n');
    },
  },

  touch: {
    desc: 'создать пустой файл или обновить время', usage: 'touch <файл>',
    async run(args, ctx) {
      if (!args.length) return err('Укажи имя файла');
      const out = [];
      for (const a of args) {
        const p = fs.resolve(a, ctx.cwd);
        try {
          const ex = await fs.stat(p);
          if (ex) { await fs.write(p, ex.blobKey ? await fs.read(p) : ex.content); out.push(dim(`обновлено: ${a}`)); }
          else { await fs.write(p, ''); out.push(ok(`создано: ${a}`)); }
        } catch (e) { out.push(err(e.message)); }
      }
      return out.join('\n');
    },
  },

  rm: {
    desc: 'удалить файл или папку', usage: 'rm [-rf] <путь>',
    async run(args, ctx) {
      const { f, rest } = flags(args);
      if (!rest.length) return err('Укажи что удалить');
      const out = [];
      for (const a of rest) {
        const p = fs.resolve(a, ctx.cwd);
        if (p === '/') { out.push(err('Отказано: корень удалять нельзя')); continue; }
        try { await fs.remove(p, { recursive: f.has('r') || f.has('f') }); out.push(ok(`удалено: ${a}`)); }
        catch (e) { out.push(err(e.message)); }
      }
      return out.join('\n');
    },
  },

  cp: {
    desc: 'копировать', usage: 'cp <из> <в>',
    async run(args, ctx) {
      if (args.length < 2) return err('Нужно два пути: cp файл копия');
      try { await fs.copy(fs.resolve(args[0], ctx.cwd), fs.resolve(args[1], ctx.cwd)); return ok('скопировано'); }
      catch (e) { return err(e.message); }
    },
  },

  mv: {
    desc: 'переместить или переименовать', usage: 'mv <из> <в>',
    async run(args, ctx) {
      if (args.length < 2) return err('Нужно два пути: mv старое новое');
      try { await fs.move(fs.resolve(args[0], ctx.cwd), fs.resolve(args[1], ctx.cwd)); return ok('перемещено'); }
      catch (e) { return err(e.message); }
    },
  },

  tree: {
    desc: 'дерево папок', usage: 'tree [путь]',
    async run(args, ctx) {
      const root = fs.resolve(args[0] || '.', ctx.cwd);
      const all = await fs.all();
      const kids = (p) => all.filter((n) => n.parent === p)
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ru') : a.type === 'dir' ? -1 : 1));
      let out = hl(root), count = { d: 0, f: 0 };
      const walk = (p, prefix, depth) => {
        if (depth > 6) return;
        const list = kids(p);
        list.forEach((n, i) => {
          const last = i === list.length - 1;
          out += `\n${prefix}${last ? '└── ' : '├── '}` + (n.type === 'dir' ? `<span class="hl">${esc(n.name)}/</span>` : esc(n.name));
          n.type === 'dir' ? count.d++ : count.f++;
          if (n.type === 'dir') walk(n.path, prefix + (last ? '    ' : '│   '), depth + 1);
        });
      };
      walk(root, '', 0);
      return out + `\n\n${dim(`${count.d} папок, ${count.f} файлов`)}`;
    },
  },

  find: {
    desc: 'найти файлы по имени', usage: 'find <текст>',
    async run(args) {
      if (!args[0]) return err('Что искать?');
      const r = await fs.find(args[0], { limit: 50 });
      if (!r.length) return dim('ничего не найдено');
      return r.map((n) => `${n.type === 'dir' ? hl(n.path + '/') : esc(n.path)}  ${dim(fmtSize(n.size))}`).join('\n');
    },
  },

  stat: {
    desc: 'информация о файле', usage: 'stat <путь>',
    async run(args, ctx) {
      const p = fs.resolve(args[0] || '.', ctx.cwd);
      const n = await fs.stat(p);
      if (!n) return err(`Нет такого пути: ${p}`);
      return [
        `${dim('путь')}      ${esc(n.path)}`,
        `${dim('тип')}       ${n.type === 'dir' ? 'папка' : 'файл'}`,
        `${dim('размер')}    ${fmtSize(n.size)}`,
        `${dim('права')}     ${modeStr(n)} (${(n.mode ?? 0).toString(8)})`,
        `${dim('владелец')}  ${n.owner}:${n.group}`,
        `${dim('mime')}      ${n.mime}`,
        `${dim('создан')}    ${fmtDateTime(n.created)}`,
        `${dim('изменён')}   ${fmtDateTime(n.modified)}`,
      ].join('\n');
    },
  },

  head: {
    desc: 'первые строки файла', usage: 'head [-n N] <файл>',
    async run(args, ctx) {
      let n = 10, rest = [...args];
      const i = rest.indexOf('-n');
      if (i >= 0) { n = parseInt(rest[i + 1]) || 10; rest.splice(i, 2); }
      if (!rest[0]) return err('Укажи файл');
      try {
        const c = await fs.read(fs.resolve(rest[0], ctx.cwd));
        return esc(String(c).split('\n').slice(0, n).join('\n'));
      } catch (e) { return err(e.message); }
    },
  },

  tail: {
    desc: 'последние строки файла', usage: 'tail [-n N] <файл>',
    async run(args, ctx) {
      let n = 10, rest = [...args];
      const i = rest.indexOf('-n');
      if (i >= 0) { n = parseInt(rest[i + 1]) || 10; rest.splice(i, 2); }
      if (!rest[0]) return err('Укажи файл');
      try {
        const c = await fs.read(fs.resolve(rest[0], ctx.cwd));
        return esc(String(c).split('\n').slice(-n).join('\n'));
      } catch (e) { return err(e.message); }
    },
  },

  wc: {
    desc: 'счётчик строк, слов, символов', usage: 'wc <файл>',
    async run(args, ctx) {
      if (!args[0]) return err('Укажи файл');
      try {
        const c = String(await fs.read(fs.resolve(args[0], ctx.cwd)));
        const lines = c ? c.split('\n').length : 0;
        const words = c.trim() ? c.trim().split(/\s+/).length : 0;
        return `${lines} строк  ${words} слов  ${c.length} символов  ${esc(args[0])}`;
      } catch (e) { return err(e.message); }
    },
  },

  grep: {
    desc: 'поиск текста в файле', usage: 'grep <текст> <файл>',
    async run(args, ctx) {
      if (args.length < 2) return err('Нужен текст и файл: grep ошибка log.txt');
      const [q, ...files] = args;
      const out = [];
      for (const fl of files) {
        try {
          const c = String(await fs.read(fs.resolve(fl, ctx.cwd)));
          c.split('\n').forEach((ln, i) => {
            if (ln.toLowerCase().includes(q.toLowerCase())) {
              const marked = esc(ln).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<span class="wr">${m}</span>`);
              out.push(`${dim(fl + ':' + (i + 1))}  ${marked}`);
            }
          });
        } catch (e) { out.push(err(e.message)); }
      }
      return out.length ? out.join('\n') : dim('совпадений нет');
    },
  },

  du: {
    desc: 'размер папки', usage: 'du [путь]',
    async run(args, ctx) {
      const p = fs.resolve(args[0] || '.', ctx.cwd);
      return `${fmtSize(await fs.du(p))}  ${esc(p)}`;
    },
  },

  df: {
    desc: 'место в хранилище браузера',
    async run() {
      const { usage, quota } = await db.usage();
      const files = (await fs.all()).length;
      if (!quota) return `${dim('файлов в ФС:')} ${files}\n${dim('оценка недоступна в этом браузере')}`;
      const pct = Math.round((usage / quota) * 100);
      const bars = Math.round(pct / 5);
      return [
        `${dim('хранилище')} IndexedDB`,
        `${dim('занято')}    ${fmtSize(usage)} из ${fmtSize(quota)} (${pct}%)`,
        `[${'█'.repeat(bars)}${'░'.repeat(20 - bars)}]`,
        `${dim('файлов')}    ${files}`,
      ].join('\n');
    },
  },

  /* ── права и пользователи ───────────────────────────────── */
  chmod: {
    desc: 'сменить права', usage: 'chmod 755 <путь>',
    async run(args, ctx) {
      if (args.length < 2) return err('Пример: chmod 644 файл.txt');
      const m = parseMode(args[0]);
      if (m === null) return err('Права задаются восьмёркой: 644, 755, 600');
      try { await fs.chmod(fs.resolve(args[1], ctx.cwd), m); return ok(`права изменены на ${args[0]}`); }
      catch (e) { return err(e.message); }
    },
  },

  chown: {
    desc: 'сменить владельца (нужен root)', usage: 'chown user[:group] <путь>',
    async run(args, ctx) {
      if (args.length < 2) return err('Пример: chown user файл.txt');
      const [owner, group] = args[0].split(':');
      try { await fs.chown(fs.resolve(args[1], ctx.cwd), owner, group); return ok(`владелец: ${args[0]}`); }
      catch (e) { return err(e.message + (fs.getUser().root ? '' : ' — нужен sudo')); }
    },
  },

  whoami: { desc: 'текущий пользователь', run: () => fs.getUser().name },

  id: {
    desc: 'сведения о пользователе',
    run() {
      const u = fs.getUser();
      return `${dim('пользователь')} ${u.name}\n${dim('группы')}       ${(u.groups || []).join(', ') || '—'}\n${dim('root')}         ${u.root ? 'да' : 'нет'}`;
    },
  },

  sudo: {
    desc: 'выполнить команду от root', usage: 'sudo <команда>',
    async run(args, ctx) {
      if (!args.length) return err('Что выполнить? Пример: sudo chown root /etc');
      const u = fs.getUser();
      const wheel = (u.groups || []).includes('wheel') || u.root;
      if (!wheel) return err(`${u.name} отсутствует в файле sudoers. Войди как root (пароль toor).`);
      const [cmd, ...rest] = args;
      const c = commands[cmd];
      if (!c) return err(`Нет команды «${cmd}»`);
      fs.setUser({ ...u, root: true });
      try { return await c.run(rest, ctx); }
      finally { fs.setUser(u); }
    },
  },

  /* ── система ────────────────────────────────────────────── */
  ps: {
    desc: 'список процессов',
    run() {
      const list = processes.list();
      if (!list.length) return dim('нет процессов');
      const rows = list.map((p) =>
        `${String(p.pid).padStart(5)} ${p.owner.padEnd(6)} ${String(p.mem + 'M').padStart(5)} ${fmtUptime(Date.now() - p.started).padEnd(12)} ${esc(p.title)}`);
      return `${dim('  PID USER    MEM  UPTIME       NAME')}\n${rows.join('\n')}`;
    },
  },

  kill: {
    desc: 'завершить процесс', usage: 'kill <pid>',
    run(args) {
      const pid = parseInt(args[0]);
      if (!pid) return err('Укажи PID: kill 101');
      const p = processes.get(pid);
      if (!p) return err(`Нет процесса ${pid}`);
      processes.kill(pid, { force: true });
      return ok(`процесс ${pid} (${p.title}) завершён`);
    },
  },

  apps: {
    desc: 'список установленных приложений',
    run() {
      return registry.all().map((a) => `${hl(a.id.padEnd(12))} ${esc(a.name.padEnd(18))} ${dim(a.category)}`).join('\n');
    },
  },

  open: {
    desc: 'открыть приложение или файл', usage: 'open <приложение|файл>',
    async run(args, ctx) {
      if (!args[0]) return err('Что открыть? Пример: open files');
      const app = registry.get(args[0]);
      if (app) { registry.launch(app.id); return ok(`запущено: ${app.name}`); }
      const p = fs.resolve(args[0], ctx.cwd);
      const n = await fs.stat(p);
      if (!n) return err(`Нет ни приложения, ни файла «${args[0]}»`);
      if (n.type === 'dir') { registry.launch('files', { path: p }); return ok(`Файлы: ${p}`); }
      const ext = fs.extname(p);
      const app2 = ['png','jpg','jpeg','gif','webp','svg'].includes(ext) ? 'viewer' : ext === 'md' ? 'notes' : 'editor';
      registry.launch(app2, { path: p });
      return ok(`открыто в ${registry.get(app2).name}: ${n.name}`);
    },
  },

  windows: {
    desc: 'список открытых окон',
    run() {
      const list = wm.list();
      if (!list.length) return dim('нет открытых окон');
      return list.map((w) => `${String(w.id).padStart(3)} ${w.minimized ? dim('свёрнуто') : ok('активно  ')} ${esc(w.title)}`).join('\n');
    },
  },

  date: {
    desc: 'дата и время',
    run() {
      const d = new Date();
      return `${d.toLocaleString('ru-RU', { dateStyle: 'full', timeStyle: 'medium' })}\n${dim(`UTC${d.getTimezoneOffset() > 0 ? '-' : '+'}${Math.abs(d.getTimezoneOffset() / 60)} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)}`;
    },
  },

  uptime: {
    desc: 'время работы системы',
    run(a, ctx) {
      return `${dim('система')}   ${fmtUptime(Date.now() - ctx.bootTime)}\n${dim('процессов')} ${processes.count()}\n${dim('память')}    ~${processes.totalMem()} МБ (оценка)`;
    },
  },

  free: {
    desc: 'память процессов',
    run() {
      const total = processes.totalMem();
      const list = processes.list();
      return `${dim('всего оценочно')} ${total} МБ в ${list.length} процессах\n` +
        list.map((p) => `  ${String(p.mem + 'M').padStart(5)}  ${esc(p.title)}`).join('\n') +
        `\n${dim('Точная память вкладки браузеру недоступна — это оценка, см. README.')}`;
    },
  },

  history: {
    desc: 'история команд',
    run(a, ctx) {
      if (!ctx.history.length) return dim('история пуста');
      return ctx.history.map((c, i) => `${dim(String(i + 1).padStart(4))}  ${esc(c)}`).join('\n');
    },
  },

  clear: { desc: 'очистить экран', run: (a, ctx) => { ctx.clear(); return ''; } },

  export: {
    desc: 'выгрузить всю систему в JSON-файл',
    async run() {
      const files = await fs.all();
      const kv = await db.all('kv');
      const keys = await db.keys('kv');
      const data = {
        version: 1, exported: new Date().toISOString(),
        settings: Object.fromEntries(keys.map((k, i) => [k, kv[i]])),
        files: files.map(({ blobKey, ...f }) => f),
      };
      net.saveBlob(JSON.stringify(data, null, 2), `browsec-os-${Date.now()}.json`, 'application/json');
      return ok(`выгружено ${files.length} файлов — проверь папку загрузок`);
    },
  },

  reset: {
    desc: 'сбросить систему (нужно подтверждение --yes)',
    async run(args) {
      if (!args.includes('--yes')) return `${err('Это удалит ВСЕ файлы и настройки.')}\nПовтори: ${hl('reset --yes')}`;
      await db.wipe();
      return ok('система сброшена. Перезагрузи страницу (F5).');
    },
  },

  /* ── сеть ───────────────────────────────────────────────── */
  curl: {
    desc: 'HTTP-запрос', usage: 'curl [-I] <url>',
    async run(args) {
      const { f, rest } = flags(args);
      if (!rest[0]) return err('Укажи URL: curl https://api.github.com/zen');
      let url = rest[0];
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const r = await net.request(url, { method: f.has('I') ? 'HEAD' : 'GET' });
      if (!r.ok) {
        let out = err(`${r.error || 'HTTP ' + r.status}: ${r.message || r.statusText || ''}`);
        if (r.corsHint) out += `\n${dim('Домен не отдаёт CORS-заголовки. Настрой свой прокси: Настройки → Сеть, либо proxy <url>.')}`;
        return out;
      }
      const head = `${dim(`HTTP ${r.status} · ${r.latency} мс · через ${r.via === 'proxy' ? 'прокси' : 'напрямую'}`)}`;
      if (f.has('I')) return head;
      const body = String(r.text ?? '');
      const trimmed = body.length > 4000 ? body.slice(0, 4000) + `\n${dim(`… обрезано, всего ${body.length} символов`)}` : body;
      return `${head}\n${esc(trimmed)}`;
    },
  },

  wget: {
    desc: 'скачать файл в ФС', usage: 'wget <url> [путь]',
    async run(args, ctx) {
      if (!args[0]) return err('Укажи URL');
      let url = args[0];
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const r = await net.request(url);
      if (!r.ok) return err(`${r.error || r.status}: ${r.message || ''}${r.corsHint ? '\n' + dim('нужен прокси') : ''}`);
      const name = args[1] || (new URL(url).pathname.split('/').filter(Boolean).pop() || 'index.html');
      const p = fs.resolve(name, ctx.cwd);
      await fs.write(p, r.text ?? '');
      return ok(`сохранено: ${p} (${fmtSize(new TextEncoder().encode(r.text || '').byteLength)})`);
    },
  },

  ping: {
    desc: 'проверить доступность хоста', usage: 'ping <host>',
    async run(args) {
      const host = args[0] || 'api.github.com';
      const url = /^https?:\/\//i.test(host) ? host : `https://${host}`;
      const r = await net.ping(url, { count: 4 });
      const lines = r.samples.map((s, i) => s == null
        ? err(`  запрос ${i + 1}: нет ответа`)
        : `  запрос ${i + 1}: ${s} мс`);
      return [
        `${dim('PING')} ${esc(host)} ${dim('(HTTP-запросы, не ICMP — браузер не умеет ICMP)')}`,
        ...lines,
        '',
        `${dim('отправлено')} ${r.sent}, ${dim('получено')} ${r.received}, ${dim('потерь')} ${r.loss}%`,
        r.avg != null ? `${dim('мин/сред/макс')} ${r.min}/${r.avg}/${r.max} мс` : err('хост недоступен'),
      ].join('\n');
    },
  },

  ip: {
    desc: 'свой IP и провайдер (через ipapi.co)',
    async run() {
      try {
        const j = await net.json('https://ipapi.co/json/');
        return [
          `${dim('IP')}          ${esc(j.ip || '—')}`,
          `${dim('город')}       ${esc(j.city || '—')}, ${esc(j.country_name || '—')}`,
          `${dim('провайдер')}   ${esc(j.org || '—')}`,
          `${dim('часовой пояс')} ${esc(j.timezone || '—')}`,
        ].join('\n');
      } catch (e) { return err(`не удалось получить данные: ${e.message}`); }
    },
  },

  proxy: {
    desc: 'показать или задать URL прокси', usage: 'proxy [url|off]',
    async run(args) {
      if (!args[0]) {
        const p = net.proxy();
        return p ? `${dim('прокси')} ${esc(p)}` : `${dim('прокси не настроен')}\n${dim('Код воркера — в README.md, раздел «Свой прокси».')}`;
      }
      if (args[0] === 'off') { await net.setProxy(''); return ok('прокси отключён'); }
      await net.setProxy(args[0]);
      return ok(`прокси: ${net.proxy()}`);
    },
  },

  net: {
    desc: 'состояние сети',
    run() {
      const s = net.status();
      return [
        `${dim('онлайн')}      ${s.online ? ok('да') : err('нет')}`,
        `${dim('прокси')}      ${s.proxy ? esc(s.proxy) : dim('не настроен')}`,
        `${dim('запросов')}    ${s.requests} (${s.failures} с ошибкой)`,
        `${dim('задержка')}    ${s.lastLatency != null ? s.lastLatency + ' мс' : '—'}`,
        `${dim('тип связи')}   ${esc(navigator.connection?.effectiveType || 'неизвестно')}`,
      ].join('\n');
    },
  },

  /* ── прочее ─────────────────────────────────────────────── */
  echo: {
    desc: 'вывести текст', usage: 'echo текст [> файл]',
    async run(args, ctx) {
      const i = args.indexOf('>');
      const ap = args.indexOf('>>');
      if (i >= 0 || ap >= 0) {
        const redir = i >= 0 ? i : ap;
        const text = args.slice(0, redir).join(' ');
        const file = args[redir + 1];
        if (!file) return err('Укажи файл после >');
        const p = fs.resolve(file, ctx.cwd);
        try {
          const prev = ap >= 0 && await fs.exists(p) ? String(await fs.read(p)) + '\n' : '';
          await fs.write(p, prev + text);
          return ok(`записано в ${file}`);
        } catch (e) { return err(e.message); }
      }
      return esc(args.join(' '));
    },
  },

  notify: {
    desc: 'показать уведомление', usage: 'notify <текст>',
    run(args) {
      if (!args.length) return err('Укажи текст');
      notify.info('Терминал', args.join(' '));
      return dim('отправлено');
    },
  },

  theme: {
    desc: 'сменить тему', usage: 'theme dark|light|auto',
    async run(args) {
      const m = args[0];
      if (!['dark', 'light', 'auto'].includes(m)) return err('Варианты: dark, light, auto');
      const { settings } = await import('../kernel/db.js');
      const { default: desktop } = await import('../shell/desktop.js');
      await settings.set('theme', m);
      desktop.applyTheme(m);
      return ok(`тема: ${m}`);
    },
  },

  exit: { desc: 'закрыть терминал', run: (a, ctx) => { ctx.close(); return ''; } },
};

export default commands;