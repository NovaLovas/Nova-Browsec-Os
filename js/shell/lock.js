/* lock.js — экран входа и регистрации NovaOS. */

import bus from '../kernel/bus.js';
import users, { checkPasswordStrength, checkUsername } from '../kernel/users.js';
import icon from '../ui/icons.js';
import { h, esc, fmtTime, fmtDate, dayName } from '../ui/dom.js';
import sound from '../services/sound.js';
import notify from '../services/notify.js';

let host = null;
let mode = 'login';
let pendingUser = null;
let timer = null;

function tickClock() {
  const c = host?.querySelector('.lock-clock');
  if (!c) return;
  const d = new Date();
  c.querySelector('.time').textContent = fmtTime(d);
  c.querySelector('.date').textContent = `${fmtDate(d)} · ${dayName(d)}`;
}

function strengthLevel(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\w\s]/.test(pw)) s++;
  const labels = ['очень слабый','слабый','средний','хороший','сильный','отличный'];
  const colors = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e','#10b981'];
  return { level: s, label: labels[s], color: colors[s] };
}

export const lock = {
  init() {
    host = document.getElementById('lock');
    if (!host) { console.error('[lock] нет элемента #lock'); return; }
    host.innerHTML = `
      <div class="lock-clock"><div class="time">--:--</div><div class="date"></div></div>
      <div class="lock-body"></div>`;
    tickClock();
    if (timer) clearInterval(timer);
    timer = setInterval(tickClock, 1000);
  },

  show() {
    if (!host) return;
    mode = 'login';
    lock.render();
    host.classList.remove('hidden', 'out');
  },

  hide() {
    if (!host) return;
    host.classList.add('out');
    setTimeout(() => host.classList.add('hidden'), 420);
  },

  render() {
    const body = host.querySelector('.lock-body');
    if (!body) return;

    if (mode === 'login') {
      let usersList = [];
      try { usersList = users.all().filter((u) => !u.root); } catch (e) { console.error('[lock]', e); }

      body.innerHTML = `
        <div class="lock-users">
          ${usersList.map((u) => `
            <button class="user-btn" data-u="${esc(u.name)}">
              <div class="user-avatar">${esc((u.label[0] || 'U').toUpperCase())}</div>
              <div class="user-name">${esc(u.label)}</div>
            </button>`).join('')}
          <button class="user-btn user-new" data-new>
            <div class="user-avatar">+</div>
            <div class="user-name">Создать</div>
          </button>
        </div>
        <form class="lock-form hidden" autocomplete="off">
          <div class="lf-title">Вход</div>
          <input name="password" type="password" placeholder="Пароль" autocomplete="current-password">
          <div class="lf-hint"></div>
          <div class="lf-actions">
            <button type="button" class="btn" data-back>Назад</button>
            <button type="submit" class="btn primary">Войти</button>
          </div>
        </form>`;

      body.querySelectorAll('[data-u]').forEach((b) => {
        b.onclick = () => lock.pickUser(b.dataset.u);
      });
      body.querySelector('[data-new]').onclick = () => { mode = 'register'; lock.render(); };
    } else {
      body.innerHTML = `
        <form class="lock-form lock-register" autocomplete="off">
          <div class="lf-title">Регистрация</div>
          <div class="lf-row">
            <input name="label" type="text" placeholder="Отображаемое имя" maxlength="32">
          </div>
          <div class="lf-row">
            <input name="name" type="text" placeholder="Логин (a-z, 0-9, _, -)" autocomplete="username" spellcheck="false">
          </div>
          <div class="lf-row">
            <input name="password" type="password" placeholder="Пароль (мин. 8 символов)" autocomplete="new-password">
          </div>
          <div class="lf-strength"><div class="bar"><i></i></div><span class="lbl"></span></div>
          <div class="lf-row">
            <input name="confirm" type="password" placeholder="Повтор пароля" autocomplete="new-password">
          </div>
          <div class="lf-hint"></div>
          <div class="lf-actions">
            <button type="button" class="btn" data-back>Назад</button>
            <button type="submit" class="btn primary">Создать аккаунт</button>
          </div>
        </form>`;

      const form = body.querySelector('form');
      const pw = form.querySelector('[name="password"]');
      const bar = form.querySelector('.lf-strength .bar i');
      const lbl = form.querySelector('.lf-strength .lbl');
      pw.oninput = () => {
        const s = strengthLevel(pw.value);
        bar.style.width = (s.level / 5 * 100) + '%';
        bar.style.background = s.color;
        lbl.textContent = pw.value ? s.label : '';
      };
      form.onsubmit = (e) => { e.preventDefault(); lock.submitRegister(form); };
      form.querySelector('[data-back]').onclick = () => { mode = 'login'; lock.render(); };
      setTimeout(() => form.querySelector('[name="label"]').focus(), 60);
    }
  },

  pickUser(name) {
    const needs = users.needsPassword(name);
    if (!needs) return lock.doLogin(name, '');
    const body = host.querySelector('.lock-body');
    body.querySelector('.lock-users')?.classList.add('hidden');
    const form = body.querySelector('.lock-form');
    form.classList.remove('hidden');
    form.querySelector('.lf-title').textContent = name;
    const inp = form.querySelector('[name="password"]');
    setTimeout(() => inp.focus(), 60);
    form.onsubmit = (e) => { e.preventDefault(); lock.doLogin(name, inp.value); };
    form.querySelector('[data-back]').onclick = () => { mode = 'login'; lock.render(); };
  },

  async doLogin(name, password) {
    const r = await users.login(name, password);
    const hint = host.querySelector('.lf-hint');
    if (!r.ok) {
      if (hint) { hint.textContent = r.error; hint.classList.add('err'); }
      host.querySelector('.lock-form')?.classList.add('shake');
      setTimeout(() => host.querySelector('.lock-form')?.classList.remove('shake'), 400);
      sound.error();
      return;
    }
    lock.hide();
    sound.login();
    notify.success(`Привет, ${r.user.label}`, '', { timeout: 2400, silent: true });
    bus.emit('session:unlocked', r.user);
  },

  async submitRegister(form) {
    const label = form.querySelector('[name="label"]').value.trim();
    const name = form.querySelector('[name="name"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const confirm = form.querySelector('[name="confirm"]').value;
    const hint = form.querySelector('.lf-hint');

    if (password !== confirm) {
      hint.textContent = 'Пароли не совпадают';
      hint.classList.add('err');
      sound.error();
      return;
    }
    const r = await users.register({ name, password, label: label || name });
    if (!r.ok) {
      hint.textContent = r.error;
      hint.classList.add('err');
      sound.error();
      return;
    }
    sound.success();
    notify.success('Аккаунт создан', `Добро пожаловать, ${r.user.label}`);
    await lock.doLogin(r.user.name, password);
  },
};

export default lock;