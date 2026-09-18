/* passwords.js — менеджер паролей. Vault AES-GCM-256, мастер-пароль. */

import vault from '../services/vault.js';
import registry from '../shell/registry.js';
import clipboard from '../services/clipboard.js';
import notify from '../services/notify.js';
import sound from '../services/sound.js';
import icon from '../ui/icons.js';
import { h, esc, confirm, fmtAgo } from '../ui/dom.js';

/* ── Экран блокировки хранилища ─────────────────────────────────── */
function unlockScreen(root, win, onUnlocked) {
  root.innerHTML = `
    <div class="pw-lock">
      <div class="pw-lock-box">
        <div class="pw-lock-icon">${icon('shield', 'ill')}</div>
        <h3>Разблокировать хранилище</h3>
        <p>Мастер-пароль расшифровывает все записи. Он не хранится нигде — только в памяти.</p>
        <form autocomplete="off">
          <input name="pw" type="password" placeholder="Мастер-пароль" autocomplete="current-password">
          <div class="hint"></div>
          <button class="btn primary" type="submit">Разблокировать</button>
        </form>
        <button class="pw-forget" type="button">Забыли пароль? Сбросить хранилище</button>
      </div>
    </div>`;
  const form = root.querySelector('form');
  const hint = root.querySelector('.hint');
  setTimeout(() => form.querySelector('[name="pw"]').focus(), 60);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const pw = form.querySelector('[name="pw"]').value;
    try { await vault.unlock(pw); }
    catch {
      hint.textContent = 'Неверный пароль';
      hint.classList.add('err');
      form.classList.add('shake');
      setTimeout(() => form.classList.remove('shake'), 400);
      sound.error();
      return;
    }
    sound.success();
    onUnlocked();
  };
  root.querySelector('.pw-forget').onclick = async () => {
    const ok = await confirm({
      title: 'Сбросить хранилище?', ok: 'Сбросить', danger: true,
      message: 'Все пароли будут потеряны навсегда. Восстановить их невозможно.',
    });
    if (!ok) return;
    await vault.wipe();
    notify.info('Хранилище очищено', '');
    createScreen(root, win, onUnlocked);
  };
}

/* ── Экран создания хранилища ───────────────────────────────────── */
function createScreen(root, win, onUnlocked) {
  root.innerHTML = `
    <div class="pw-lock">
      <div class="pw-lock-box">
        <div class="pw-lock-icon" style="color:var(--accent)">${icon('shield', 'ill')}</div>
        <h3>Создать хранилище</h3>
        <p>Задай мастер-пароль. Он не восстанавливается — потеряешь его, потеряешь все данные.</p>
        <form autocomplete="off">
          <input name="pw" type="password" placeholder="Мастер-пароль (мин. 8 символов)" autocomplete="new-password">
          <div class="pw-meter"><i></i></div>
          <input name="confirm" type="password" placeholder="Повтор" autocomplete="new-password">
          <div class="hint"></div>
          <button class="btn primary" type="submit">Создать</button>
        </form>
      </div>
    </div>`;
  const form = root.querySelector('form');
  const pw = form.querySelector('[name="pw"]');
  const hint = root.querySelector('.hint');
  const meter = root.querySelector('.pw-meter i');
  pw.oninput = () => {
    const v = pw.value;
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[A-Z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[^\w\s]/.test(v)) s++;
    const colors = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e','#10b981'];
    meter.style.width = (s / 5 * 100) + '%';
    meter.style.background = colors[s];
  };
  setTimeout(() => pw.focus(), 60);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const p1 = pw.value;
    const p2 = form.querySelector('[name="confirm"]').value;
    if (p1 !== p2) { hint.textContent = 'Пароли не совпадают'; hint.classList.add('err'); return; }
    if (p1.length < 8) { hint.textContent = 'Минимум 8 символов'; hint.classList.add('err'); return; }
    try { await vault.create(p1); } catch (err) { hint.textContent = err.message; hint.classList.add('err'); return; }
    sound.success();
    onUnlocked();
  };
}

/* ── Главный экран ──────────────────────────────────────────────── */
function mainScreen(root, win) {
  let selectedId = null;
  let search = '';
  let dirty = false;

  root.innerHTML = `
    <div class="app-row">
      <div class="pw-side">
        <div class="pw-side-head">
          <button class="btn sm primary" data-a="new" title="Новый пароль">${icon('plus')}</button>
          <input class="fld pw-search" placeholder="Поиск…" spellcheck="false">
        </div>
        <div class="pw-list"></div>
        <div class="pw-side-foot">
          <button class="btn sm ghost" data-a="gen" title="Генератор">${icon('zap')}<span>Генератор</span></button>
          <button class="btn sm ghost" data-a="lock" title="Заблокировать">${icon('lock')}</button>
        </div>
      </div>
      <div class="pane">
        <div class="pw-detail"></div>
      </div>
    </div>`;

  const listEl = root.querySelector('.pw-list');
  const detailEl = root.querySelector('.pw-detail');
  const searchEl = root.querySelector('.pw-search');

  function renderList() {
    const items = vault.search(search);
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.appendChild(h(`<div class="pw-empty">${search ? 'Ничего не найдено' : 'Пусто. Создай первую запись.'}</div>`));
      return;
    }
    for (const it of items) {
      const row = h(`
        <button class="pw-item ${it.id === selectedId ? 'on' : ''}">
          <span class="pw-fav">${esc((it.title[0] || '?').toUpperCase())}</span>
          <span class="pw-item-meta">
            <span class="pw-item-title">${esc(it.title)}</span>
            <span class="pw-item-user">${esc(it.username || it.url || '—')}</span>
          </span>
        </button>`);
      row.onclick = () => { selectedId = it.id; renderList(); renderDetail(); };
      listEl.appendChild(row);
    }
  }

  function renderDetail() {
    const it = selectedId ? vault.list().find((x) => x.id === selectedId) : null;
    if (!it) {
      detailEl.innerHTML = `
        <div class="pw-placeholder">
          ${icon('shield', 'ill')}
          <h4>${vault.list().length ? 'Выбери запись слева' : 'Хранилище пусто'}</h4>
          <p>${vault.list().length ? 'Или создай новую кнопкой +' : 'Нажми +, чтобы добавить первый пароль.'}</p>
          <button class="btn primary" data-a="new">${icon('plus')}<span>Новая запись</span></button>
        </div>`;
      detailEl.querySelector('[data-a="new"]').onclick = createNew;
      return;
    }

    detailEl.innerHTML = `
      <div class="pw-head">
        <div class="pw-avatar">${esc((it.title[0] || '?').toUpperCase())}</div>
        <div class="pw-head-tx">
          <h2>${esc(it.title)}</h2>
          <div class="pw-head-sub">создано ${esc(fmtAgo(it.created))}${it.updated !== it.created ? ' · изменено ' + esc(fmtAgo(it.updated)) : ''}</div>
        </div>
        <button class="btn icon ghost" data-a="edit" title="Редактировать">${icon('edit')}</button>
        <button class="btn icon ghost" data-a="del" title="Удалить">${icon('trash')}</button>
      </div>
      <div class="pw-fields">
        ${field('Логин', it.username, 'user')}
        ${field('Пароль', it.password, 'password')}
        ${field('URL', it.url, 'link', true)}
        ${it.notes ? field('Заметки', it.notes, 'notes', true, true) : ''}
      </div>
      ${it.tags?.length ? `<div class="pw-tags">${it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}`;

    detailEl.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.copy;
        if (!v) return;
        clipboard.set(v);
        notify.success('Скопировано', 'В буфере NovaOS', { timeout: 1600, silent: true });
      };
    });
    detailEl.querySelectorAll('[data-reveal]').forEach((b) => {
      b.onclick = () => {
        const target = detailEl.querySelector(`[data-value="${b.dataset.reveal}"]`);
        if (!target) return;
        const shown = target.dataset.shown === '1';
        target.dataset.shown = shown ? '0' : '1';
        target.textContent = shown ? '•'.repeat(it.password.length) : it.password;
        b.innerHTML = icon(shown ? 'eye' : 'eye');
      };
    });
    detailEl.querySelector('[data-a="edit"]').onclick = () => editScreen(it);
    detailEl.querySelector('[data-a="del"]').onclick = async () => {
      const ok = await confirm({
        title: 'Удалить запись?', ok: 'Удалить', danger: true,
        message: `<b>${esc(it.title)}</b> будет удалена безвозвратно.`,
      });
      if (!ok) return;
      await vault.remove(it.id);
      selectedId = null;
      renderList();
      renderDetail();
    };
  }

  function field(label, value, kind = 'text', small = false, multiline = false) {
    if (!value) return '';
    const isPassword = kind === 'password';
    const display = isPassword ? '•'.repeat(value.length) : value;
    return `
      <div class="pw-field ${small ? 'sm' : ''}">
        <div class="pw-field-lb">${esc(label)}</div>
        <div class="pw-field-val ${multiline ? 'multi' : ''}">
          <span data-value="${esc(value)}" data-shown="${isPassword ? 0 : 1}">${esc(display)}</span>
          ${isPassword ? `<button class="pw-btn" data-reveal="${esc(value)}" title="Показать">${icon('eye')}</button>` : ''}
          <button class="pw-btn" data-copy="${esc(value)}" title="Скопировать">${icon('copy')}</button>
        </div>
      </div>`;
  }

  function createNew() {
    selectedId = null;
    editScreen({ title: '', username: '', password: vault.generate(20), url: '', notes: '', tags: [] });
  }

  function editScreen(entry) {
    const isNew = !entry.id;
    detailEl.innerHTML = `
      <div class="pw-head">
        <div class="pw-avatar">${esc((entry.title[0] || '+').toUpperCase())}</div>
        <div class="pw-head-tx">
          <h2>${isNew ? 'Новая запись' : 'Редактирование'}</h2>
          <div class="pw-head-sub">${isNew ? 'Заполни поля' : esc(entry.title)}</div>
        </div>
      </div>
      <form class="pw-form" autocomplete="off">
        <label class="pw-form-row">
          <span>Название</span>
          <input name="title" class="fld" value="${esc(entry.title)}" placeholder="Например: Gmail" required>
        </label>
        <label class="pw-form-row">
          <span>Логин</span>
          <input name="username" class="fld" value="${esc(entry.username)}" placeholder="you@example.com">
        </label>
        <label class="pw-form-row">
          <span>Пароль</span>
          <div class="pw-form-pw">
            <input name="password" class="fld" value="${esc(entry.password)}" spellcheck="false">
            <button type="button" class="btn sm" data-gen>${icon('refresh')}</button>
            <button type="button" class="btn sm" data-show>${icon('eye')}</button>
          </div>
        </label>
        <label class="pw-form-row">
          <span>URL</span>
          <input name="url" class="fld" value="${esc(entry.url)}" placeholder="https://">
        </label>
        <label class="pw-form-row">
          <span>Заметки</span>
          <textarea name="notes" class="fld" style="height:70px;resize:vertical;padding:8px 11px">${esc(entry.notes)}</textarea>
        </label>
        <div class="pw-form-actions">
          <button type="button" class="btn" data-cancel>Отмена</button>
          <button type="submit" class="btn primary">${isNew ? 'Создать' : 'Сохранить'}</button>
        </div>
      </form>`;

    const form = detailEl.querySelector('form');
    const pwInp = form.querySelector('[name="password"]');
    form.querySelector('[data-gen]').onclick = () => { pwInp.value = vault.generate(20); };
    form.querySelector('[data-show]').onclick = (e) => {
      const t = pwInp.type === 'password' ? 'text' : 'password';
      pwInp.type = t;
      e.currentTarget.innerHTML = icon(t === 'password' ? 'eye' : 'edit');
    };
    form.querySelector('[data-cancel]').onclick = () => { renderList(); renderDetail(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = {
        title: fd.get('title').trim() || 'Без названия',
        username: fd.get('username').trim(),
        password: fd.get('password'),
        url: fd.get('url').trim(),
        notes: fd.get('notes').trim(),
      };
      let saved;
      if (isNew) saved = await vault.add(data);
      else saved = await vault.update(entry.id, data);
      selectedId = saved.id;
      sound.success();
      notify.success(isNew ? 'Пароль сохранён' : 'Обновлено', data.title, { timeout: 1800, silent: true });
      renderList();
      renderDetail();
    };
  }

  async function openGenerator() {
    detailEl.innerHTML = `
      <div class="pw-head"><div class="pw-head-tx"><h2>Генератор паролей</h2></div></div>
      <div class="pw-gen">
        <div class="pw-gen-out" id="pw-gen-out">—</div>
        <div class="pw-gen-opts">
          <label>Длина <input type="range" min="8" max="64" value="20" data-opt="len" class="rng"><span class="pw-gen-len">20</span></label>
          <label class="chk"><input type="checkbox" data-opt="upper" checked> Заглавные</label>
          <label class="chk"><input type="checkbox" data-opt="digits" checked> Цифры</label>
          <label class="chk"><input type="checkbox" data-opt="symbols" checked> Символы</label>
        </div>
        <div class="pw-gen-actions">
          <button class="btn primary" data-regen>${icon('refresh')}<span>Сгенерировать</span></button>
          <button class="btn" data-copy-gen>${icon('copy')}<span>Скопировать</span></button>
        </div>
      </div>`;
    const out = detailEl.querySelector('#pw-gen-out');
    const getOpts = () => ({
      upper: detailEl.querySelector('[data-opt="upper"]').checked,
      digits: detailEl.querySelector('[data-opt="digits"]').checked,
      symbols: detailEl.querySelector('[data-opt="symbols"]').checked,
    });
    const getLen = () => +detailEl.querySelector('[data-opt="len"]').value;
    const regen = () => { out.textContent = vault.generate(getLen(), getOpts()); };
    detailEl.querySelector('[data-opt="len"]').oninput = (e) => {
      detailEl.querySelector('.pw-gen-len').textContent = e.target.value;
      regen();
    };
    detailEl.querySelectorAll('[data-opt]').forEach((c) => {
      if (c.type === 'checkbox') c.onchange = regen;
    });
    detailEl.querySelector('[data-regen]').onclick = regen;
    detailEl.querySelector('[data-copy-gen]').onclick = () => {
      clipboard.set(out.textContent);
      notify.success('Скопировано', '', { timeout: 1400, silent: true });
    };
    regen();
  }

  root.querySelector('[data-a="new"]').onclick = createNew;
  root.querySelector('[data-a="gen"]').onclick = openGenerator;
  root.querySelector('[data-a="lock"]').onclick = () => {
    vault.lock();
    notify.info('Хранилище заблокировано', '', { timeout: 1600, silent: true });
    unlockScreen(root, win, () => mainScreen(root, win));
  };
  searchEl.oninput = () => { search = searchEl.value; renderList(); };

  // Автоблокировка при потере фокуса окна на 10 минут
  let blurTimer = null;
  const onBlur = () => {
    blurTimer = setTimeout(() => {
      vault.lock();
      notify.warn('Хранилище автоматически заблокировано', '10 минут без активности');
      unlockScreen(root, win, () => mainScreen(root, win));
    }, 10 * 60 * 1000);
  };
  const onFocus = () => clearTimeout(blurTimer);
  win.node.addEventListener('blur', onBlur, true);
  win.node.addEventListener('focus', onFocus, true);
  win.onCleanup(() => clearTimeout(blurTimer));

  renderList();
  renderDetail();
  win.setTitle('Пароли');
}

/* ── Регистрация ────────────────────────────────────────────────── */
export default function register() {
  registry.register({
    id: 'passwords', name: 'Пароли', icon: 'shield',
    color: 'linear-gradient(135deg,#10b981,#059669)',
    width: 780, height: 540, minWidth: 520, minHeight: 320,
    category: 'Безопасность', desc: 'Хранилище паролей с AES-GCM-256',
    keywords: ['пароли','vault','keepass','менеджер','шифрование','password'],
    mount(root, win) {
      (async () => {
        if (!(await vault.exists())) {
          createScreen(root, win, () => mainScreen(root, win));
        } else if (!vault.isUnlocked()) {
          unlockScreen(root, win, () => mainScreen(root, win));
        } else {
          mainScreen(root, win);
        }
      })();
    },
  });
}