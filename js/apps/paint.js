/* paint.js — простой растровый редактор. Сохраняет PNG в ФС. */

import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import registry from '../shell/registry.js';
import icon from '../ui/icons.js';
import { h, esc, prompt, confirm } from '../ui/dom.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';

const COLORS = ['#111827', '#ef4444', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const SIZES  = [1, 2, 4, 8, 16, 28];

function mount(root, win, args) {
  let tool = 'brush';          // brush | eraser | line | rect | circle
  let color = '#111827';
  let size = 4;
  let drawing = false;
  let start = null;
  let snapshot = null;

  root.innerHTML = `
    <div class="app">
      <div class="pt-tools">
        <button class="pt-tool" data-t="brush"  title="Кисть">${icon('edit')}</button>
        <button class="pt-tool" data-t="eraser" title="Ластик">${icon('eraser')}</button>
        <button class="pt-tool" data-t="line"   title="Линия">${icon('line')}</button>
        <button class="pt-tool" data-t="rect"   title="Прямоугольник">${icon('square')}</button>
        <button class="pt-tool" data-t="circle" title="Эллипс">${icon('circle')}</button>
        <span style="width:8px"></span>
        <div class="pt-colors"></div>
        <span style="width:8px"></span>
        <select class="fld" style="width:auto;height:28px" data-a="size">
          ${SIZES.map((s) => `<option value="${s}" ${s === size ? 'selected' : ''}>${s}px</option>`).join('')}
        </select>
        <span class="grow"></span>
        <button class="btn sm" data-a="clear">${icon('trash')}<span>Очистить</span></button>
        <button class="btn sm" data-a="open">${icon('folder')}<span>Открыть</span></button>
        <button class="btn sm primary" data-a="save">${icon('save')}<span>Сохранить</span></button>
      </div>
      <div class="pt-canvas-wrap">
        <canvas class="pt-canvas" width="900" height="600"></canvas>
      </div>
    </div>`;

  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* цвета */
  const colorsBox = root.querySelector('.pt-colors');
  for (const c of COLORS) {
    const b = h(`<button class="pt-c ${c === color ? 'on' : ''}" style="background:${c}" title="${c}"></button>`);
    b.onclick = () => {
      color = c;
      colorsBox.querySelectorAll('.pt-c').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
    colorsBox.appendChild(b);
  }

  /* инструменты */
  const toolBtns = [...root.querySelectorAll('[data-t]')];
  const syncTools = () => toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.t === tool));
  toolBtns.forEach((b) => { b.onclick = () => { tool = b.dataset.t; syncTools(); }; });
  syncTools();

  root.querySelector('[data-a="size"]').onchange = (e) => { size = +e.target.value; };

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * canvas.width / r.width),
      y: Math.round((e.clientY - r.top) * canvas.height / r.height),
    };
  };

  const styleFor = () => {
    ctx.lineWidth = size;
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.fillStyle = color;
  };

  function draw(e) {
    const p = pos(e);
    if (tool === 'brush' || tool === 'eraser') {
      styleFor();
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    start = pos(e);
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (tool === 'brush' || tool === 'eraser') {
      styleFor();
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(start.x + 0.01, start.y + 0.01);
      ctx.stroke();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    if (tool === 'brush' || tool === 'eraser') { draw(e); return; }
    // восстановить снапшот и нарисовать предпросмотр
    ctx.putImageData(snapshot, 0, 0);
    styleFor();
    if (tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (tool === 'rect') {
      ctx.strokeRect(start.x, start.y, p.x - start.x, p.y - start.y);
    } else if (tool === 'circle') {
      const rx = Math.abs(p.x - start.x) / 2;
      const ry = Math.abs(p.y - start.y) / 2;
      ctx.beginPath();
      ctx.ellipse(start.x + (p.x - start.x) / 2, start.y + (p.y - start.y) / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  const endDraw = () => {
    if (!drawing) return;
    drawing = false;
    snapshot = null;
    sound.click();
  };
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointerleave', endDraw);

  /* кнопки */
  root.querySelector('[data-a="clear"]').onclick = async () => {
    const ok = await confirm({ title: 'Очистить холст?', message: 'Всё нарисованное будет потеряно.', ok: 'Очистить', danger: true });
    if (!ok) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  root.querySelector('[data-a="open"]').onclick = async () => {
    const p = await prompt({
      title: 'Открыть изображение',
      message: 'Путь к PNG или JPG в файловой системе.',
      value: fs.join(users.home(), 'Изображения', ''),
    });
    if (!p) return;
    try {
      const blob = await fs.read(fs.resolve(p.trim(), users.home()), { asBlob: true });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        notify.success('Открыто', p);
      };
      img.onerror = () => notify.error('Не картинка', 'Не удалось декодировать файл.');
      img.src = url;
    } catch (e) { notify.error('Не удалось открыть', e.message); }
  };

  root.querySelector('[data-a="save"]').onclick = async () => {
    const p = await prompt({
      title: 'Сохранить как',
      message: 'Куда сохранить PNG?',
      value: fs.join(users.home(), 'Изображения', 'рисунок.png'),
    });
    if (!p) return;
    try {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      await fs.write(fs.resolve(p.trim(), users.home()), blob, { mime: 'image/png' });
      sound.success();
      notify.success('Сохранено', p, { timeout: 2500 });
    } catch (e) { notify.error('Не удалось сохранить', e.message); }
  };

  win.setTitle('Paint');
  if (args?.path) {
    // можно открыть существующий файл
    (async () => {
      try {
        const blob = await fs.read(args.path, { asBlob: true });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      } catch { /* не открылось — оставим пустой холст */ }
    })();
  }
}

export default function register() {
  registry.register({
    id: 'paint', name: 'Paint', icon: 'palette',
    color: 'linear-gradient(135deg,#f43f5e,#e11d48)',
    width: 940, height: 640, minWidth: 480, minHeight: 400,
    category: 'Медиа', desc: 'Растровый редактор: кисть, фигуры, сохранение в ФС',
    keywords: ['рисовать','paint','canvas','изображение'],
    mount,
  });
}