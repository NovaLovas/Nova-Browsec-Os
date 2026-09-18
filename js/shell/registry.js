/* registry.js — реестр приложений. Сторонний разработчик регистрирует приложение здесь.
   Манифест: { id, name, icon, color, width, height, category, mount(container, api, args) } */

import bus from '../kernel/bus.js';
import processes from '../kernel/processes.js';
import wm from './wm.js';

const apps = new Map();

export const registry = {
  /** Зарегистрировать приложение. */
  register(manifest) {
    const m = {
      id: manifest.id,
      name: manifest.name || manifest.id,
      icon: manifest.icon || 'window',
      color: manifest.color || 'linear-gradient(135deg,#6366f1,#8b5cf6)',
      width: manifest.width || 760,
      height: manifest.height || 500,
      minWidth: manifest.minWidth,
      minHeight: manifest.minHeight,
      category: manifest.category || 'Прочее',
      desc: manifest.desc || '',
      desktop: manifest.desktop !== false,
      singleton: !!manifest.singleton,
      resizable: manifest.resizable !== false,
      keywords: manifest.keywords || [],
      mount: manifest.mount,
    };
    if (!m.id || typeof m.mount !== 'function') {
      throw new Error(`registry: приложению нужны id и mount() (${m.id || '?'})`);
    }
    apps.set(m.id, m);
    bus.emit('app:register', m);
    return m;
  },

  get(id) { return apps.get(id) || null; },
  all() { return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')); },
  onDesktop() { return registry.all().filter((a) => a.desktop); },
  categories() {
    const m = new Map();
    for (const a of registry.all()) {
      if (!m.has(a.category)) m.set(a.category, []);
      m.get(a.category).push(a);
    }
    return m;
  },

  /** Поиск для Spotlight и меню «Пуск». */
  search(q) {
    const s = q.toLowerCase().trim();
    if (!s) return registry.all();
    return registry.all()
      .map((a) => {
        const n = a.name.toLowerCase();
        let score = n === s ? 100 : n.startsWith(s) ? 80 : n.includes(s) ? 60 : 0;
        if (!score && a.keywords.some((k) => k.toLowerCase().includes(s))) score = 40;
        if (!score && a.desc.toLowerCase().includes(s)) score = 20;
        return { a, score };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name, 'ru'))
      .map((x) => x.a);
  },

  /**
   * Запустить приложение. args передаются в mount третьим параметром.
   * Для singleton-приложений повторный запуск фокусирует существующее окно.
   */
  launch(id, args = null) {
    const app = apps.get(id);
    if (!app) throw new Error(`Приложение не найдено: ${id}`);

    if (app.singleton) {
      const existing = wm.list().find((w) => w.appId === id);
      if (existing) {
        wm.focus(existing.id);
        if (args) bus.emit(`app:${id}:args`, args);
        return wm.get(existing.id) ? wm.api(wm.get(existing.id)) : null;
      }
    }

    const proc = processes.spawn(id, { title: app.name, kind: 'app' });
    return wm.open({
      appId: id, pid: proc.pid, title: app.name, iconName: app.icon, color: app.color,
      width: app.width, height: app.height, minWidth: app.minWidth, minHeight: app.minHeight,
      resizable: app.resizable,
      mount: (container, winApi) => app.mount(container, winApi, args),
    });
  },

  count() { return apps.size; },
};

export default registry;
