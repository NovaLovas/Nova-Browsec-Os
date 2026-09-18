/* processes.js — таблица процессов. Один процесс = один запущенный экземпляр приложения. */

import bus from './bus.js';

let nextPid = 100;
const table = new Map();

export const processes = {
  /** Создать процесс. Возвращает объект процесса. */
  spawn(appId, { title = appId, owner = 'user', kind = 'app', meta = {} } = {}) {
    const pid = nextPid++;
    const proc = {
      pid, appId, title, owner, kind, meta,
      started: Date.now(),
      state: 'running',            // running | suspended
      mem: 8 + Math.round(Math.random() * 24),  // оценка, см. README
      winId: null,
    };
    table.set(pid, proc);
    bus.emit('proc:spawn', proc);
    return proc;
  },

  get(pid) { return table.get(pid) || null; },
  list() { return [...table.values()].sort((a, b) => a.pid - b.pid); },
  byApp(appId) { return [...table.values()].filter((p) => p.appId === appId); },
  count() { return table.size; },

  /** Завершить процесс. Окно закрывается через событие. */
  kill(pid, { force = false } = {}) {
    const p = table.get(pid);
    if (!p) return false;
    if (p.kind === 'system' && !force) return false;
    table.delete(pid);
    bus.emit('proc:kill', p);
    return true;
  },

  suspend(pid) {
    const p = table.get(pid);
    if (!p) return false;
    p.state = 'suspended';
    bus.emit('proc:update', p);
    return true;
  },

  resume(pid) {
    const p = table.get(pid);
    if (!p) return false;
    p.state = 'running';
    bus.emit('proc:update', p);
    return true;
  },

  /** Привязать окно к процессу. */
  attachWindow(pid, winId) {
    const p = table.get(pid);
    if (p) { p.winId = winId; bus.emit('proc:update', p); }
  },

  setTitle(pid, title) {
    const p = table.get(pid);
    if (p) { p.title = title; bus.emit('proc:update', p); }
  },

  /** Суммарная оценка памяти (МБ). */
  totalMem() { return [...table.values()].reduce((s, p) => s + p.mem, 0); },

  uptime(pid) {
    const p = table.get(pid);
    return p ? Date.now() - p.started : 0;
  },
};

export default processes;
