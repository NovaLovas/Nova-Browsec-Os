/* clipboard.js — изолированный буфер обмена Browsec OS.
   Не трогает системный буфер Windows/Linux/macOS.
   Хранится в памяти + IndexedDB. Есть ручной экспорт/импорт. */

import db from '../kernel/db.js';
import bus from '../kernel/bus.js';

const KEY = 'os-clipboard';
let cache = { text: '', items: [] };

export const clipboard = {
  async init() {
    const saved = await db.get('kv', KEY);
    if (saved && typeof saved === 'object') cache = saved;
    return cache;
  },

  get() { return cache.text || ''; },
  history() { return [...cache.items]; },

  async set(text) {
    cache.text = String(text ?? '');
    cache.items = [{ type: 'text', value: cache.text, at: Date.now() }, ...cache.items.slice(0, 19)];
    await db.put('kv', cache, KEY);
    bus.emit('clipboard:change', cache.text);
    return cache.text;
  },

  async clear() {
    cache = { text: '', items: [] };
    await db.put('kv', cache, KEY);
    bus.emit('clipboard:change', '');
  },

  /* Явное взаимодействие с системным буфером — только по запросу пользователя */
  async exportToSystem() {
    try {
      await navigator.clipboard.writeText(cache.text);
      return true;
    } catch { return false; }
  },

  async importFromSystem() {
    try {
      const t = await navigator.clipboard.readText();
      await clipboard.set(t);
      return t;
    } catch { return null; }
  },
};

/** Вешает перехватчики copy/cut/paste на документ. */
export function installClipboardHooks() {
  document.addEventListener('copy', (e) => {
    const sel = globalThis.getSelection?.()?.toString() || '';
    if (!sel) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    clipboard.set(sel);
  }, true);

  document.addEventListener('cut', (e) => {
    const sel = globalThis.getSelection?.()?.toString() || '';
    const target = e.target;
    if (sel) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clipboard.set(sel);
    }
    // Вырезаем текст из поля вручную
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? start;
      if (end > start) {
        target.setRangeText('', start, end, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }, true);

  document.addEventListener('paste', (e) => {
    if (!cache.text) return;   // не мешаем, если буфер ОС пуст
    e.preventDefault();
    e.stopImmediatePropagation();
    const text = cache.text;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      target.setRangeText(text, start, end, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (target?.isContentEditable) {
      try { document.execCommand('insertText', false, text); } catch {}
    }
  }, true);
}

export default clipboard;