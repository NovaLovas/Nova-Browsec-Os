/* camera.js — камера: живой поток, снимок сохраняется в /Изображения. */

import fs from '../kernel/fs.js';
import users from '../kernel/users.js';
import registry from '../shell/registry.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';
import net from '../services/net.js';
import icon from '../ui/icons.js';
import { h, esc } from '../ui/dom.js';

function mount(root, win) {
  let stream = null;
  let facing = 'user';
  let lastShot = null;

  root.innerHTML = `
    <div class="cam">
      <div class="cam-view"></div>
      <div class="cam-ctl">
        <button class="btn icon ghost" data-a="switch" title="Сменить камеру">${icon('refresh')}</button>
        <button class="cam-shot" data-a="shot" title="Снимок" aria-label="Снимок"></button>
        <button class="btn icon ghost" data-a="disk" title="Сохранить последний снимок на диск" disabled>${icon('download')}</button>
      </div>
    </div>`;

  const view = root.querySelector('.cam-view');
  const shotBtn = root.querySelector('[data-a="shot"]');
  const diskBtn = root.querySelector('[data-a="disk"]');
  const switchBtn = root.querySelector('[data-a="switch"]');

  if (!isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    view.appendChild(h(`
      <div class="empty" style="color:#ddd">
        ${icon('shield', 'ill')}
        <h4>Камера недоступна</h4>
        <p>Браузер даёт доступ к камере только на <code>http://localhost</code> или HTTPS. Ты открыл <code>${esc(location.protocol)}//${esc(location.host)}</code>.</p>
      </div>`));
    return;
  }

  async function start() {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;
      v.srcObject = stream;
      view.innerHTML = '';
      view.appendChild(v);
      win.setTitle('Камера');
    } catch (e) {
      view.innerHTML = '';
      view.appendChild(h(`
        <div class="empty" style="color:#ddd">
          ${icon('alert', 'ill')}
          <h4>Камера не запустилась</h4>
          <p style="user-select:text">${esc(e.message || 'доступ запрещён')}</p>
        </div>`));
    }
  }

  function stop() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  shotBtn.onclick = async () => {
    const v = view.querySelector('video');
    if (!v) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    // снимок как видит пользователь (зеркало — если фронтальная)
    if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0);
    sound.shutter();

    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    lastShot = blob;

    const dir = fs.join(users.home(), 'Изображения');
    await fs.mkdir(dir, { recursive: true, quiet: true });
    const name = `Снимок ${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    const p = fs.join(dir, name);
    try {
      await fs.write(p, blob, { mime: 'image/png' });
      diskBtn.disabled = false;
      notify.success('Снимок сохранён', p, {
        timeout: 3500,
        actions: [{ label: 'Открыть', primary: true, onClick: () => registry.launch('viewer', { path: p }) }],
      });
    } catch (e) { notify.error('Не удалось сохранить', e.message); }
  };

  diskBtn.onclick = () => {
    if (!lastShot) return;
    net.saveBlob(lastShot, `Снимок-${Date.now()}.png`);
  };

  switchBtn.onclick = () => {
    facing = facing === 'user' ? 'environment' : 'user';
    start();
  };

  win.onCleanup(stop);
  start();
}

export default function register() {
  registry.register({
    id: 'camera', name: 'Камера', icon: 'camera',
    color: 'linear-gradient(135deg,#64748b,#334155)',
    width: 720, height: 560, minWidth: 420, minHeight: 380,
    category: 'Медиа', desc: 'Веб-камера, снимок в /Изображения',
    keywords: ['камера','camera','фото','снимок'],
    mount,
  });
}