/* db.js — обёртка над IndexedDB. Три стора: files, kv, blobs. */

const NAME = 'browsec-os';
const VERSION = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) {
      rej(new Error('IndexedDB недоступен. Открой систему по http://localhost, не через file://'));
      return;
    }
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'path' });
        s.createIndex('parent', 'parent', { unique: false });
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      void e;
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      res(req.result);
    };
    req.onerror = () => rej(req.error || new Error('Не удалось открыть IndexedDB'));
    req.onblocked = () => rej(new Error('IndexedDB заблокирована другой вкладкой Browsec OS'));
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && out.__req ? out.__req.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('transaction aborted'));
  }));
}

const wrap = (req) => ({ __req: req });

export const db = {
  ready: () => open().then(() => true),

  get:  (store, key)  => tx(store, 'readonly',  (s) => wrap(s.get(key))),
  all:  (store)       => tx(store, 'readonly',  (s) => wrap(s.getAll())),
  keys: (store)       => tx(store, 'readonly',  (s) => wrap(s.getAllKeys())),
  count:(store)       => tx(store, 'readonly',  (s) => wrap(s.count())),

  put:  (store, val, key) => tx(store, 'readwrite', (s) => { s.put(val, key); return true; }),
  del:  (store, key)      => tx(store, 'readwrite', (s) => { s.delete(key); return true; }),
  clear:(store)           => tx(store, 'readwrite', (s) => { s.clear(); return true; }),

  /** Пакетная запись — одна транзакция на все элементы. */
  putMany: (store, items) => tx(store, 'readwrite', (s) => {
    for (const it of items) Array.isArray(it) ? s.put(it[0], it[1]) : s.put(it);
    return items.length;
  }),

  delMany: (store, keys) => tx(store, 'readwrite', (s) => {
    for (const k of keys) s.delete(k);
    return keys.length;
  }),

  /** Все записи с префиксом ключа (для дерева ФС). */
  byPrefix: (store, prefix) => tx(store, 'readonly', (s) => {
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    return wrap(s.getAll(range));
  }),

  /** Оценка занятого места. */
  async usage() {
    if (navigator.storage?.estimate) {
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        return { usage, quota };
      } catch { /* игнор */ }
    }
    return { usage: 0, quota: 0 };
  },

  /** Полный сброс — используется в «сбросить систему». */
  async wipe() {
    const d = await open();
    d.close();
    dbp = null;
    return new Promise((res, rej) => {
      const r = indexedDB.deleteDatabase(NAME);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
      r.onblocked = () => res(true);
    });
  },
};

/* Простые настройки — через kv-стор, с кэшем в памяти. */
const cache = new Map();
export const settings = {
  async load() {
    const keys = await db.keys('kv');
    for (const k of keys) cache.set(k, await db.get('kv', k));
    return Object.fromEntries(cache);
  },
  get(k, dflt = null) { return cache.has(k) ? cache.get(k) : dflt; },
  async set(k, v) { cache.set(k, v); await db.put('kv', v, k); return v; },
  async remove(k) { cache.delete(k); await db.del('kv', k); },
  all() { return Object.fromEntries(cache); },
};

export default db;
