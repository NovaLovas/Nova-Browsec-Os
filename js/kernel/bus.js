/* bus.js — шина событий. Единственный способ межслойной связи. */

const map = new Map();
let logging = false;

export const bus = {
  /** Подписаться. Возвращает функцию отписки. */
  on(evt, fn) {
    if (!map.has(evt)) map.set(evt, new Set());
    map.get(evt).add(fn);
    return () => bus.off(evt, fn);
  },

  /** Подписаться на одно срабатывание. */
  once(evt, fn) {
    const off = bus.on(evt, (...a) => { off(); fn(...a); });
    return off;
  },

  off(evt, fn) {
    map.get(evt)?.delete(fn);
  },

  /** Отправить событие. Ошибка в одном подписчике не ломает остальных. */
  emit(evt, data) {
    if (logging) console.debug('[bus]', evt, data);
    const set = map.get(evt);
    if (set) for (const fn of [...set]) {
      try { fn(data); } catch (e) { console.error(`[bus] ${evt}:`, e); }
    }
    // wildcard-подписчики получают (evt, data)
    const wild = map.get('*');
    if (wild) for (const fn of [...wild]) {
      try { fn(evt, data); } catch (e) { console.error('[bus] *:', e); }
    }
  },

  /** Дождаться события с таймаутом (мс). */
  wait(evt, timeout = 5000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { off(); rej(new Error(`timeout: ${evt}`)); }, timeout);
      const off = bus.once(evt, (d) => { clearTimeout(t); res(d); });
    });
  },

  setLogging(v) { logging = !!v; },
  listeners(evt) { return map.get(evt)?.size ?? 0; },
};

export default bus;
