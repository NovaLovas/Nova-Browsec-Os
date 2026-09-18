/* vault.js — зашифрованное хранилище паролей. AES-GCM-256, PBKDF2. */

import db from '../kernel/db.js';
import bus from '../kernel/bus.js';

const ITER = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let key = null;
let items = [];

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJSON(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: b64(iv), data: b64(cipher) };
}

async function decryptJSON(blob) {
  const iv = unb64(blob.iv);
  const data = unb64(blob.data);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(dec.decode(plain));
}

export const vault = {
  isUnlocked() { return !!key; },
  async exists() { return !!(await db.get('kv', 'vault')); },

  async create(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(password, salt);
    items = [];
    await vault.persist();
    await db.put('kv', 'vault-meta', { salt: b64(salt), created: Date.now() });
    bus.emit('vault:unlocked');
    return true;
  },

  async unlock(password) {
    const meta = await db.get('kv', 'vault-meta');
    if (!meta) throw new Error('Хранилище не найдено');
    key = await deriveKey(password, unb64(meta.salt));
    const blob = await db.get('kv', 'vault');
    items = blob ? await decryptJSON(blob) : [];
    bus.emit('vault:unlocked');
    return true;
  },

  lock() {
    key = null;
    items = [];
    bus.emit('vault:locked');
  },

  async persist() {
    if (!key) throw new Error('Хранилище заблокировано');
    const blob = await encryptJSON(items);
    await db.put('kv', 'vault', blob);
    bus.emit('vault:change', items);
  },

  async wipe() {
    key = null;
    items = [];
    await db.del('kv', 'vault');
    await db.del('kv', 'vault-meta');
    bus.emit('vault:locked');
  },

  list() { return items.slice(); },

  async add(entry) {
    const it = {
      id: crypto.randomUUID(),
      title: entry.title || 'Без названия',
      username: entry.username || '',
      password: entry.password || '',
      url: entry.url || '',
      notes: entry.notes || '',
      tags: entry.tags || [],
      created: Date.now(),
      updated: Date.now(),
    };
    items.push(it);
    await vault.persist();
    return it;
  },

  async update(id, patch) {
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return null;
    items[i] = { ...items[i], ...patch, updated: Date.now() };
    await vault.persist();
    return items[i];
  },

  async remove(id) {
    items = items.filter((x) => x.id !== id);
    await vault.persist();
  },

  generate(len = 20, opts = {}) {
    const { upper = true, digits = true, symbols = true, noAmbig = true } = opts;
    let pool = 'abcdefghijklmnopqrstuvwxyz';
    if (upper) pool += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (digits) pool += '0123456789';
    if (symbols) pool += '!@#$%^&*()-_=+[]{}<>?';
    if (noAmbig) pool = pool.replace(/[Il1O0o]/g, '');
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, (v) => pool[v % pool.length]).join('');
  },

  search(q) {
    const s = q.toLowerCase().trim();
    if (!s) return items.slice();
    return items.filter((x) =>
      [x.title, x.username, x.url, ...(x.tags || [])]
        .some((f) => String(f).toLowerCase().includes(s))
    );
  },
};

export default vault;