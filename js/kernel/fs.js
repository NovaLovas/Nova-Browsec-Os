/* fs.js — файловая система на IndexedDB.
   Плоская карта: ключ = абсолютный путь. Права rwx (0o755), владелец, время. */

import db from './db.js';
import bus from './bus.js';

export const norm = (p) => {
  if (!p) return '/';
  const abs = p.startsWith('/');
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/') || '/';
};

export const join = (...parts) => norm(parts.filter(Boolean).join('/'));
export const dirname = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i); };
export const basename = (p) => { const n = norm(p); return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1); };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

/** Разрешить путь относительно cwd. */
export const resolve = (p, cwd = '/') => norm(p?.startsWith('/') ? p : join(cwd, p || ''));

const MIME = {
  txt:'text/plain', md:'text/markdown', json:'application/json', js:'text/javascript',
  css:'text/css', html:'text/html', csv:'text/csv', log:'text/plain', sh:'text/x-sh',
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', svg:'image/svg+xml',
  webp:'image/webp', ico:'image/x-icon', wav:'audio/wav', mp3:'audio/mpeg', pdf:'application/pdf',
  app:'application/x-browsec-app',
};
export const mimeOf = (p) => MIME[extname(p)] || 'application/octet-stream';

const now = () => Date.now();

function node(path, type, extra = {}) {
  const p = norm(path);
  return {
    path: p, parent: p === '/' ? null : dirname(p), name: basename(p),
    type, content: type === 'dir' ? null : (extra.content ?? ''),
    mime: type === 'dir' ? 'inode/directory' : (extra.mime || mimeOf(p)),
    size: 0, owner: extra.owner || 'user', group: extra.group || 'users',
    mode: extra.mode ?? (type === 'dir' ? 0o755 : 0o644),
    created: extra.created ?? now(), modified: extra.modified ?? now(),
    ...('blobKey' in extra ? { blobKey: extra.blobKey } : {}),
  };
}

const byteLen = (c) => {
  if (c == null) return 0;
  if (typeof c === 'string') return new TextEncoder().encode(c).byteLength;
  if (c instanceof Blob) return c.size;
  if (c?.byteLength != null) return c.byteLength;
  return new TextEncoder().encode(String(c)).byteLength;
};

export class FSError extends Error {
  constructor(code, msg) { super(msg); this.code = code; this.name = 'FSError'; }
}
const ENOENT = (p) => new FSError('ENOENT', `Нет такого файла или папки: ${p}`);
const EEXIST = (p) => new FSError('EEXIST', `Уже существует: ${p}`);
const ENOTDIR = (p) => new FSError('ENOTDIR', `Не папка: ${p}`);
const EISDIR = (p) => new FSError('EISDIR', `Это папка: ${p}`);
const EACCES = (p) => new FSError('EACCES', `Отказано в доступе: ${p}`);

/* ── права ────────────────────────────────────────────────── */
let currentUser = { name: 'user', groups: ['users'], root: false };
export function setUser(u) { currentUser = u; }
export function getUser() { return currentUser; }

/** Проверка бита прав: 'r' | 'w' | 'x'. root проходит всегда. */
export function can(n, act, user = currentUser) {
  if (!n) return false;
  if (user.root || user.name === 'root') return true;
  const bit = { r: 4, w: 2, x: 1 }[act];
  const m = n.mode ?? 0o644;
  if (n.owner === user.name) return !!((m >> 6) & bit);
  if ((user.groups || []).includes(n.group)) return !!((m >> 3) & bit);
  return !!(m & bit);
}
export const modeStr = (n) => {
  const m = n.mode ?? 0o644;
  const t = n.type === 'dir' ? 'd' : '-';
  const p = (v) => ((v & 4) ? 'r' : '-') + ((v & 2) ? 'w' : '-') + ((v & 1) ? 'x' : '-');
  return t + p((m >> 6) & 7) + p((m >> 3) & 7) + p(m & 7);
};
export const parseMode = (s) => {
  if (/^[0-7]{3,4}$/.test(s)) return parseInt(s, 8) & 0o777;
  return null;
};

/* ── операции ─────────────────────────────────────────────── */
export const fs = {
  norm, join, dirname, basename, extname, resolve, mimeOf, modeStr, can,

  async stat(path) {
    const p = norm(path);
    const n = await db.get('files', p);
    return n || null;
  },

  async exists(path) { return !!(await fs.stat(path)); },

  async read(path, { asBlob = false } = {}) {
    const p = norm(path);
    const n = await db.get('files', p);
    if (!n) throw ENOENT(p);
    if (n.type === 'dir') throw EISDIR(p);
    if (!can(n, 'r')) throw EACCES(p);
    if (n.blobKey) {
      const b = await db.get('blobs', n.blobKey);
      return asBlob ? b : b;
    }
    return n.content ?? '';
  },

  /** Записать файл. Родительские папки создаются автоматически. */
  async write(path, content = '', opts = {}) {
    const p = norm(path);
    if (p === '/') throw EISDIR(p);
    const prev = await db.get('files', p);
    if (prev?.type === 'dir') throw EISDIR(p);
    if (prev && !can(prev, 'w')) throw EACCES(p);
    await fs.mkdir(dirname(p), { recursive: true, quiet: true });

    const isBlob = content instanceof Blob;
    const n = node(p, 'file', {
      content: isBlob ? null : content,
      mime: opts.mime || prev?.mime || mimeOf(p),
      owner: prev?.owner || opts.owner || currentUser.name,
      group: prev?.group || opts.group || 'users',
      mode: prev?.mode ?? opts.mode ?? 0o644,
      created: prev?.created ?? now(),
      ...(isBlob ? { blobKey: prev?.blobKey || `b:${p}:${now()}` } : {}),
    });
    n.size = byteLen(content);
    if (isBlob) await db.put('blobs', content, n.blobKey);
    else if (prev?.blobKey) await db.del('blobs', prev.blobKey);
    await db.put('files', n);
    bus.emit('fs:change', { path: p, op: prev ? 'update' : 'create' });
    return n;
  },

  async mkdir(path, { recursive = false, quiet = false } = {}) {
    const p = norm(path);
    if (p === '/') return null;
    const ex = await db.get('files', p);
    if (ex) {
      if (ex.type === 'dir') return recursive ? ex : (() => { throw EEXIST(p); })();
      throw ENOTDIR(p);
    }
    const parent = dirname(p);
    if (parent !== '/') {
      const pn = await db.get('files', parent);
      if (!pn) {
        if (!recursive) throw ENOENT(parent);
        await fs.mkdir(parent, { recursive: true, quiet: true });
      } else if (pn.type !== 'dir') throw ENOTDIR(parent);
      else if (!can(pn, 'w')) throw EACCES(parent);
    }
    const n = node(p, 'dir', { owner: currentUser.name });
    await db.put('files', n);
    if (!quiet) bus.emit('fs:change', { path: p, op: 'create' });
    return n;
  },

  async list(path = '/') {
    const p = norm(path);
    if (p !== '/') {
      const n = await db.get('files', p);
      if (!n) throw ENOENT(p);
      if (n.type !== 'dir') throw ENOTDIR(p);
      if (!can(n, 'r')) throw EACCES(p);
    }
    const all = await db.all('files');
    return all
      .filter((n) => n.parent === p)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ru') : a.type === 'dir' ? -1 : 1));
  },

  async remove(path, { recursive = false } = {}) {
    const p = norm(path);
    if (p === '/') throw new FSError('EBUSY', 'Нельзя удалить корень');
    const n = await db.get('files', p);
    if (!n) throw ENOENT(p);
    if (!can(n, 'w')) throw EACCES(p);
    if (n.type === 'dir') {
      const kids = (await db.all('files')).filter((k) => k.path.startsWith(p + '/'));
      if (kids.length && !recursive) throw new FSError('ENOTEMPTY', `Папка не пуста: ${p}`);
      const blobs = kids.filter((k) => k.blobKey).map((k) => k.blobKey);
      if (blobs.length) await db.delMany('blobs', blobs);
      await db.delMany('files', kids.map((k) => k.path));
    } else if (n.blobKey) await db.del('blobs', n.blobKey);
    await db.del('files', p);
    bus.emit('fs:change', { path: p, op: 'delete' });
    return true;
  },

  async move(from, to) {
    const a = norm(from), b = norm(to);
    const n = await db.get('files', a);
    if (!n) throw ENOENT(a);
    if (await db.get('files', b)) throw EEXIST(b);
    if (b.startsWith(a + '/')) throw new FSError('EINVAL', 'Нельзя переместить папку внутрь себя');
    await fs.mkdir(dirname(b), { recursive: true, quiet: true });

    const items = n.type === 'dir'
      ? [n, ...(await db.all('files')).filter((k) => k.path.startsWith(a + '/'))]
      : [n];
    const moved = items.map((it) => {
      const np = it.path === a ? b : b + it.path.slice(a.length);
      return { ...it, path: np, parent: np === '/' ? null : dirname(np), name: basename(np), modified: now() };
    });
    await db.putMany('files', moved);
    await db.delMany('files', items.map((i) => i.path).filter((p) => !moved.some((m) => m.path === p)));
    bus.emit('fs:change', { path: a, to: b, op: 'move' });
    return moved[0];
  },

  async copy(from, to) {
    const a = norm(from), b = norm(to);
    const n = await db.get('files', a);
    if (!n) throw ENOENT(a);
    if (await db.get('files', b)) throw EEXIST(b);
    if (n.type === 'dir') {
      await fs.mkdir(b, { recursive: true, quiet: true });
      for (const k of (await db.all('files')).filter((k) => k.path.startsWith(a + '/'))) {
        await fs.copy(k.path, b + k.path.slice(a.length));
      }
    } else {
      const content = n.blobKey ? await db.get('blobs', n.blobKey) : n.content;
      await fs.write(b, content, { mime: n.mime, mode: n.mode });
    }
    bus.emit('fs:change', { path: b, op: 'create' });
    return db.get('files', b);
  },

  async chmod(path, mode) {
    const p = norm(path);
    const n = await db.get('files', p);
    if (!n) throw ENOENT(p);
    if (n.owner !== currentUser.name && !currentUser.root) throw EACCES(p);
    n.mode = mode & 0o777; n.modified = now();
    await db.put('files', n);
    bus.emit('fs:change', { path: p, op: 'update' });
    return n;
  },

  async chown(path, owner, group) {
    const p = norm(path);
    if (!currentUser.root) throw EACCES(p);
    const n = await db.get('files', p);
    if (!n) throw ENOENT(p);
    n.owner = owner; if (group) n.group = group; n.modified = now();
    await db.put('files', n);
    bus.emit('fs:change', { path: p, op: 'update' });
    return n;
  },

  /** Все узлы (для поиска, экспорта, дерева). */
  async all() { return db.all('files'); },

  /** Поиск по имени, регистронезависимо. */
  async find(query, { limit = 40, root = '/' } = {}) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const all = await db.all('files');
    return all
      .filter((n) => n.path.startsWith(root) && n.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q) || a.name.length - b.name.length)
      .slice(0, limit);
  },

  /** Рекурсивный размер. */
  async du(path = '/') {
    const p = norm(path);
    const all = await db.all('files');
    return all.filter((n) => n.path === p || n.path.startsWith(p === '/' ? '/' : p + '/'))
      .reduce((s, n) => s + (n.size || 0), 0);
  },
};

export default fs;

