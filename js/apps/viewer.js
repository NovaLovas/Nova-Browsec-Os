/* viewer.js — просмотрщик изображений: зум, поворот, следующий/предыдущий в папке. */

import fs from '../kernel/fs.js';
import registry from '../shell/registry.js';
import net from '../services/net.js';
import notify from '../services/notify.js';
import icon from '../ui/icons.js';
import { h, esc, fmtSize } from '../ui/dom.js';

const IMG = ['png','jpg','jpeg','gif','webp','svg','ico','bmp'];

function mount(root, win, args) {
  let path = args?.path ? fs.norm(args.path) : null;
  let siblings = [];
  let idx = -1;
  let scale = 1;
  let rot = 0;
  let url = null;

  root.innerHTML = `
    <div class="app">
      <div class="bar">
        <button class="btn icon ghost" data-a="prev" title="Предыдущее">${icon('chevronLeft')}</button>
        <button class="btn icon ghost" data-a="next" title="Следующее">${icon('chevronRight')}</button>
        <span class="grow"></span>
        <span class="name" style="font-size:12px;color:var(--fg-3);margin-right:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40vw"></span>
        <button class="btn icon ghost" data-a="out" title="Уменьшить">−</button>
        <span class="zoom" style="font-size:11.5px;width:44px;text-align:center;color:var(--fg-3)">100%</span>
        <button class="btn icon ghost" data-a="in" title="Увеличить">+</button>
        <button class="btn icon ghost" data-a="rot" title="Повернуть">${icon('refresh')}</button>
        <button class="btn icon ghost" data-a="reset" title="Сбросить">${icon('restore')}</button>
        <button class="btn icon ghost" data-a="disk" title="Сохранить на диск">${icon('download')}</button>
      </div>
      <div class="vw"></div>
      <div class="bar btm">
        <span class="info"></span>
        <span class="grow"></span>
        <span class="size"></span>
      </div>
    </div>`;

  const vw = root.querySelector('.vw');
  const nameEl = root.querySelector('.name');
  const zoomEl = root.querySelector('.zoom');
  const infoEl = root.querySelector('.info');
  const sizeEl = root.querySelector('.size');

  async function loadSiblings() {
    if (!path) return;
    try {
      const dir = fs.dirname(path);
      const list = await fs.list(dir);
      siblings = list.filter((n) => n.type === 'file' && IMG.includes(fs.extname(n.path))).map((n) => n.path);
      idx = siblings.indexOf(path);
    } catch { siblings = []; idx = -1; }
  }

  async function show() {
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (!path) { renderEmpty(); return; }
    vw.innerHTML = '<div class="spin" style="margin:auto"></div>';
    try {
      const n = await fs.stat(path);
      const blob = await fs.read(path, { asBlob: true });
      const real = blob instanceof Blob ? blob : new Blob([blob], { type: n?.mime });
      url = URL.createObjectURL(real);

      const img = new Image();
      img.onload = () => {
        vw.innerHTML = '';
        vw.appendChild(img);
        nameEl.textContent = fs.basename(path);
        infoEl.textContent = path;
        sizeEl.textContent = `${img.naturalWidth}×${img.naturalHeight} · ${fmtSize(real.size)}`;
        applyTransform();
        win.setTitle(`${fs.basename(path)} — Просмотр`);
      };
      img.onerror = () => {
        vw.innerHTML = '';
        vw.appendChild(h(`<div class="empty">${icon('alert','ill')}<h4>Не удалось открыть</h4><p>Файл не декодируется как изображение.</p></div>`));
      };
      img.src = url;
    } catch (e) {
      vw.innerHTML = '';
      vw.appendChild(h(`<div class="empty">${icon('alert','ill')}<h4>Файл недоступен</h4><p>${esc(e.message)}</p></div>`));
    }
  }

  function applyTransform() {
    const img = vw.querySelector('img');
    if (!img) return;
    img.style.transform = `scale(${scale}) rotate(${rot}deg)`;
    img.style.transition = 'transform 120ms var(--ease)';
    zoomEl.textContent = Math.round(scale * 100) + '%';
  }

  function renderEmpty() {
    vw.innerHTML = '';
    vw.appendChild(h(`<div class="empty">${icon('image','ill')}<h4>Нет изображения</h4><p>Открой файл из Файлов или перетащи сюда PNG/JPG.</p></div>`));
    nameEl.textContent = '';
    infoEl.textContent = '';
    sizeEl.textContent = '';
    win.setTitle('Просмотр');
  }

  function go(d) {
    if (!siblings.length) return;
    idx = (idx + d + siblings.length) % siblings.length;
    path = siblings[idx];
    scale = 1; rot = 0;
    show();
  }

  root.querySelector('[data-a="prev"]').onclick = () => go(-1);
  root.querySelector('[data-a="next"]').onclick = () => go(1);
  root.querySelector('[data-a="in"]').onclick  = () => { scale = Math.min(8, scale * 1.25); applyTransform(); };
  root.querySelector('[data-a="out"]').onclick = () => { scale = Math.max(0.1, scale / 1.25); applyTransform(); };
  root.querySelector('[data-a="rot"]').onclick = () => { rot = (rot + 90) % 360; applyTransform(); };
  root.querySelector('[data-a="reset"]').onclick = () => { scale = 1; rot = 0; applyTransform(); };
  root.querySelector('[data-a="disk"]').onclick = async () => {
    if (!path) return;
    const blob = await fs.read(path, { asBlob: true });
    net.saveBlob(blob, fs.basename(path));
    notify.success('Сохранено на диск', fs.basename(path));
  };

  /* drag & drop */
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    const p = fs.join(fs.dirname(path || '/tmp/x'), f.name);
    await fs.write(p, f, { mime: f.type });
    path = p;
    await loadSiblings();
    scale = 1; rot = 0;
    show();
  });

  (async () => {
    await loadSiblings();
    if (path) show(); else renderEmpty();
  })();
}

export default function register() {
  registry.register({
    id: 'viewer', name: 'Просмотр', icon: 'image',
    color: 'linear-gradient(135deg,#06b6d4,#0891b2)',
    width: 820, height: 600, minWidth: 420, minHeight: 320,
    category: 'Медиа', desc: 'Просмотр изображений из ФС',
    keywords: ['картинка','image','viewer','png','jpg'],
    mount,
  });
}