/* users.js — пользователи и вход. Пароли хешируются через SHA-256 (WebCrypto). */

import db, { settings } from './db.js';
import bus from './bus.js';
import { setUser } from './fs.js';

const DEFAULT_USERS = [
  { name: 'user',  label: 'Пользователь', role: 'Обычный доступ',       groups: ['users'],        root: false, pass: null },
  { name: 'root',  label: 'root',         role: 'Полный доступ',         groups: ['users','wheel'], root: true,  pass: 'toor' },
  { name: 'guest', label: 'Гость',        role: 'Только чтение и запуск', groups: ['guests'],      root: false, pass: null },
];

async function sha256(txt) {
  if (!crypto?.subtle) return `plain:${txt}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let list = [];
let current = null;

export const users = {
  async init() {
    let stored = await db.get('kv', 'users');
    if (!stored) {
      stored = [];
      for (const u of DEFAULT_USERS) {
        stored.push({ ...u, pass: u.pass ? await sha256(u.pass) : null });
      }
      await db.put('kv', stored, 'users');
    }
    list = stored;
    return list;
  },

  all() { return list.map(({ pass, ...u }) => ({ ...u, hasPass: !!pass })); },
  get(name) { const u = list.find((x) => x.name === name); return u ? { ...u } : null; },
  current() { return current ? { ...current } : null; },

  needsPassword(name) { return !!list.find((u) => u.name === name)?.pass; },

  async login(name, password = '') {
    const u = list.find((x) => x.name === name);
    if (!u) return { ok: false, error: 'Пользователь не найден' };
    if (u.pass) {
      const h = await sha256(password);
      if (h !== u.pass) return { ok: false, error: 'Неверный пароль' };
    }
    current = { name: u.name, label: u.label, groups: u.groups, root: u.root };
    setUser(current);
    await settings.set('lastUser', u.name);
    bus.emit('user:login', current);
    return { ok: true, user: { ...current } };
  },

  logout() {
    const prev = current;
    current = null;
    setUser({ name: 'nobody', groups: [], root: false });
    bus.emit('user:logout', prev);
  },

  async setPassword(name, password) {
    const u = list.find((x) => x.name === name);
    if (!u) return false;
    u.pass = password ? await sha256(password) : null;
    await db.put('kv', list, 'users');
    return true;
  },

  home(name = current?.name) { return name === 'root' ? '/root' : `/home/${name || 'user'}`; },
};

export default users;