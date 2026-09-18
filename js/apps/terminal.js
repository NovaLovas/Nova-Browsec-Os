/* terminal.js — терминал NovaOS. Python через Pyodide (WASM). */

import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import { settings } from '../kernel/db.js';
import registry from '../shell/registry.js';
import clipboard from '../services/clipboard.js';
import commands, { tokenize } from './shell-cmds.js';
import sound from '../services/sound.js';
import notify from '../services/notify.js';
import icon from '../ui/icons.js';
import { h, esc } from '../ui/dom.js';

const BOOT_TIME = Date.now();

/* ── Pyodide loader ─────────────────────────────────────────────── */
let pyodideP = null;

async function getPyodide(onStatus) {
  if (pyodideP) return pyodideP;
  pyodideP = (async () => {
    onStatus?.('загружаю Pyodide (~10 МБ, один раз)…');
    if (!globalThis.loadPyodide) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';
        s.onload = res;
        s.onerror = () => rej(new Error('Не удалось загрузить Pyodide. Проверь сеть.'));
        document.head.appendChild(s);
      });
    }
    onStatus?.('инициализирую Python…');
    const py = await globalThis.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
    });
    onStatus?.('готово');
    return py;
  })().catch((e) => { pyodideP = null; throw e; });
  return pyodideP;
}

function mount(root, win, args) {
  let cwd = args?.cwd || users.home();
  let history = settings.get('termHistory', []) || [];
  let hIdx = history.length;
  let draft = '';

  root.innerHTML = `
    <div class="term">
      <div class="term-out" tabindex="0"></div>
      <div class="term-in">
        <span class="ps"></span>
        <input spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Командная строка">
      </div>
    </div>`;

  const out = root.querySelector('.term-out');
  const inp = root.querySelector('input');
  const psEl = root.querySelector('.term-in .ps');

  const shortCwd = () => {
    const home = users.home();
    return cwd === home ? '~' : cwd.startsWith(home + '/') ? '~' + cwd.slice(home.length) : cwd;
  };
  const prompt = () => {
    try { return `${fs.getUser().name}@nova:${shortCwd()}$`; }
    catch { return 'nova$'; }
  };
  const updatePs = () => { psEl.textContent = prompt(); };

  const write = (html, cls = '') => {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.innerHTML = html;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  };

  const ctx = {
    get cwd() { return cwd; },
    setCwd: (p) => { cwd = p; updatePs(); },
    prevCwd: null,
    history,
    bootTime: BOOT_TIME,
    clear: () => { out.innerHTML = ''; },
    close: () => win.close(),
    write,
  };

  /* ── Pyodide-команды ──────────────────────────────────────────── */
  async function cmdPy(args) {
    const code = args.join(' ');
    if (!code) {
      write('<span class="dm">Python (Pyodide WASM). Примеры:</span>');
      write('  <span class="hl">py print(2 + 2)</span>');
      write('  <span class="hl">py import math; print(math.pi)</span>');
      write('  <span class="hl">pip numpy</span>');
      write('  <span class="hl">run script.py</span>');
      return;
    }
    let py;
    try { py = await getPyodide((s) => write(`<span class="dm">${esc(s)}</span>`)); }
    catch (e) { write(`<span class="er">${esc(e.message)}</span>`); return; }

    py.setStdout({ batched: (s) => write(esc(s)) });
    py.setStderr({ batched: (s) => write(`<span class="er">${esc(s)}</span>`) });

    try {
      const result = await py.runPythonAsync(code);
      if (result !== undefined) write(`<span class="ok">${esc(String(result))}</span>`);
    } catch (e) {
      write(`<span class="er">Python: ${esc(e.message)}</span>`);
    }
  }

  async function cmdPip(args) {
    if (!args.length) { write('<span class="dm">pip install <пакет></span>'); return; }
    const pkgs = args[0] === 'install' ? args.slice(1) : args;
    if (!pkgs.length) { write('<span class="er">Укажи пакеты: pip install numpy pandas</span>'); return; }
    let py;
    try { py = await getPyodide((s) => write(`<span class="dm">${esc(s)}</span>`)); }
    catch (e) { write(`<span class="er">${esc(e.message)}</span>`); return; }
    try {
      write(`<span class="dm">Устанавливаю: ${esc(pkgs.join(' '))}…</span>`);
      await py.loadPackage(pkgs, { messageCallback: (m) => write(`<span class="dm">${esc(m)}</span>`) });
      write(`<span class="ok">Готово: ${esc(pkgs.join(' '))}</span>`);
    } catch (e) {
      write(`<span class="er">pip: ${esc(e.message)}</span>`);
    }
  }

  async function cmdRun(args) {
    if (!args[0]) { write('<span class="er">run <файл.py></span>'); return; }
    const p = fs.resolve(args[0], cwd);
    let code;
    try { code = String(await fs.read(p)); }
    catch (e) { write(`<span class="er">${esc(e.message)}</span>`); return; }
    const wasCwd = cwd;
    try {
      // эмулируем рабочую папку для скрипта
      const py = await getPyodide((s) => write(`<span class="dm">${esc(s)}</span>`));
      py.setStdout({ batched: (s) => write(esc(s)) });
      py.setStderr({ batched: (s) => write(`<span class="er">${esc(s)}</span>`) });
      await py.runPythonAsync(code);
    } catch (e) {
      write(`<span class="er">${esc(e.message)}</span>`);
    }
    void wasCwd;
  }

  /* ── Основной exec ────────────────────────────────────────────── */
  async function exec(line) {
    const trimmed = line.trim();
    write(`<span class="ps">${esc(prompt())}</span> ${esc(line)}`);
    if (!trimmed) return;

    history = [...history.filter((c) => c !== trimmed), trimmed].slice(-200);
    ctx.history = history;
    hIdx = history.length;
    try { settings.set('termHistory', history); } catch {}

    for (const part of trimmed.split('&&').map((s) => s.trim()).filter(Boolean)) {
      const [cmd, ...cargs] = tokenize(part);
      if (!cmd) continue;

      // Питон-команды
      if (cmd === 'py' || cmd === 'python' || cmd === 'python3') {
        await cmdPy(cargs);
        continue;
      }
      if (cmd === 'pip') { await cmdPip(cargs); continue; }
      if (cmd === 'run') { await cmdRun(cargs); continue; }

      const c = commands[cmd];
      if (!c) {
        const app = registry.get(cmd);
        if (app) {
          registry.launch(cmd);
          write(`<span class="ok">запущено: ${esc(app.name)}</span>`);
          continue;
        }
        write(`<span class="er">Команда не найдена: ${esc(cmd)}</span>\n<span class="dm">Напиши help — покажу список.</span>`);
        sound.error();
        continue;
      }
      try {
        const res = await c.run(cargs, ctx);
        if (res) write(res);
      } catch (e) {
        write(`<span class="er">Ошибка: ${esc(e.message)}</span>`);
        console.error('[terminal]', e);
      }
    }
  }

  async function complete() {
    const v = inp.value;
    const parts = v.split(/\s+/);
    const last = parts[parts.length - 1] || '';

    if (parts.length === 1) {
      const names = [...Object.keys(commands), 'py', 'pip', 'run', ...registry.all().map((a) => a.id)];
      const m = names.filter((n) => n.startsWith(last));
      if (m.length === 1) { inp.value = m[0] + ' '; return; }
      if (m.length > 1) write(`<span class="dm">${m.join('   ')}</span>`);
      return;
    }

    const dir = last.includes('/') ? fs.resolve(last.slice(0, last.lastIndexOf('/')) || '/', cwd) : cwd;
    const frag = last.includes('/') ? last.slice(last.lastIndexOf('/') + 1) : last;
    let list = [];
    try { list = await fs.list(dir); } catch { return; }
    const m = list.filter((n) => n.name.startsWith(frag));
    if (m.length === 1) {
      const done = last.slice(0, last.length - frag.length) + m[0].name + (m[0].type === 'dir' ? '/' : ' ');
      parts[parts.length - 1] = done;
      inp.value = parts.join(' ');
    } else if (m.length > 1) {
      write(`<span class="dm">${m.map((n) => esc(n.name) + (n.type === 'dir' ? '/' : '')).join('   ')}</span>`);
    }
  }

  inp.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const v = inp.value;
      inp.value = '';
      await exec(v);
      inp.focus();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); await complete(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hIdx === history.length) draft = inp.value;
      if (hIdx > 0) { hIdx--; inp.value = history[hIdx]; }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hIdx < history.length - 1) { hIdx++; inp.value = history[hIdx]; }
      else { hIdx = history.length; inp.value = draft; }
      return;
    }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; return; }
    if (e.key === 'c' && e.ctrlKey && !inp.selectionStart) {
      e.preventDefault();
      write(`<span class="dm">^C</span>`);
      inp.value = '';
      return;
    }
    if (e.key.length === 1) sound.key();
  });

  root.addEventListener('pointerup', (e) => {
    if (!globalThis.getSelection?.()?.toString() && !e.target.closest('a')) inp.focus();
  });

  setTimeout(() => { try { inp.focus(); } catch {} }, 80);

  updatePs();
  write(`<span class="hl">NovaOS</span> <span class="dm">shell · ${esc(globalThis.navigator?.platform || 'browser')}</span>`);
  try {
    write(`<span class="dm">Пользователь ${esc(fs.getUser().name)}. Напиши</span> <span class="ok">help</span><span class="dm">, чтобы увидеть команды. Для Python: </span><span class="ok">py --help</span>`);
  } catch {
    write(`<span class="dm">Напиши</span> <span class="ok">help</span><span class="dm">, чтобы увидеть команды.</span>`);
  }
  write('');

  if (args?.run) exec(args.run);

  const onKey = (e) => {
    if (!win.isFocused()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    if (e.key === 'v') {
      e.preventDefault();
      const t = clipboard.get();
      if (!t) return;
      const start = inp.selectionStart ?? inp.value.length;
      const end = inp.selectionEnd ?? start;
      inp.setRangeText(t.replace(/\n/g, ' '), start, end, 'end');
      return;
    }
  };
  document.addEventListener('keydown', onKey);
  win.onCleanup(() => document.removeEventListener('keydown', onKey));
}

export default function register() {
  registry.register({
    id: 'terminal', name: 'Терминал', icon: 'terminal',
    color: 'linear-gradient(135deg,#1f2937,#0f172a)',
    width: 820, height: 500, minWidth: 420, minHeight: 240,
    category: 'Система', desc: 'Shell + Python (WASM) через Pyodide',
    keywords: ['shell','консоль','cmd','bash','терминал','python','pyodide'],
    mount,
  });
}