/* calculator.js — калькулятор с историей. Свой парсер выражений, без eval(). */

import { settings } from '../kernel/db.js';
import registry from '../shell/registry.js';
import icon from '../ui/icons.js';
import { h, esc } from '../ui/dom.js';
import sound from '../services/sound.js';
import notify from '../services/notify.js';

/* ── парсер: рекурсивный спуск ─────────────────────────────
   expr   := term (('+'|'-') term)*
   term   := unary (('*'|'/'|'%'|'×'|'÷') unary)*
   unary  := ('-'|'+') unary | power
   power  := atom ('^' unary)?      — правая ассоциативность
   atom   := number | '(' expr ')' | func '(' expr ')' | const | atom '!'
*/
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
  round: Math.round, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
};
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2 };

export function evalExpr(src) {
  const s = String(src).replace(/\s+/g, '').replace(/,(\d)/g, '.$1');
  if (!s) throw new Error('Пустое выражение');
  let i = 0;

  const peek = () => s[i];
  const eat = (c) => (s[i] === c ? (i++, true) : false);

  function expr() {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-') || eat('−')) v -= term();
      else return v;
    }
  }
  function term() {
    let v = unary();
    for (;;) {
      if (eat('*') || eat('×')) v *= unary();
      else if (eat('/') || eat('÷')) {
        const d = unary();
        if (d === 0) throw new Error('Деление на ноль');
        v /= d;
      }
      else if (eat('%')) {
        const d = unary();
        if (d === 0) throw new Error('Деление на ноль');
        v %= d;
      }
      else return v;
    }
  }
  function unary() {
    if (eat('-') || eat('−')) return -unary();
    if (eat('+')) return unary();
    return power();
  }
  function power() {
    const base = atom();
    if (eat('^')) return Math.pow(base, unary());
    return base;
  }
  function atom() {
    let v;
    if (eat('(')) {
      v = expr();
      if (!eat(')')) throw new Error('Не закрыта скобка');
    } else {
      const name = /^[a-zA-Zπ]+/.exec(s.slice(i))?.[0];
      if (name) {
        const lower = name.toLowerCase();
        if (FUNCS[lower]) {
          i += name.length;
          if (!eat('(')) throw new Error(`После ${lower} нужна скобка`);
          const arg = expr();
          if (!eat(')')) throw new Error('Не закрыта скобка');
          v = FUNCS[lower](arg);
        } else if (lower in CONSTS) {
          i += name.length;
          v = CONSTS[lower];
        } else throw new Error(`Неизвестное имя: ${name}`);
      } else {
        const m = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(s.slice(i));
        if (!m) throw new Error(`Не понял символ «${peek() ?? 'конец'}»`);
        i += m[0].length;
        v = parseFloat(m[0]);
      }
    }
    // постфиксы: процент и факториал
    for (;;) {
      if (eat('!')) {
        if (v < 0 || !Number.isInteger(v) || v > 170) throw new Error('Факториал: целое 0…170');
        let r = 1; for (let k = 2; k <= v; k++) r *= k;
        v = r;
      } else break;
    }
    return v;
  }

  const out = expr();
  if (i < s.length) throw new Error(`Лишний символ «${s[i]}»`);
  if (!Number.isFinite(out)) throw new Error('Результат не число');
  return out;
}

const KEYS = [
  ['C','fn'],['(','fn'],[')','fn'],['÷','op'],
  ['7',''],['8',''],['9',''],['×','op'],
  ['4',''],['5',''],['6',''],['−','op'],
  ['1',''],['2',''],['3',''],['+','op'],
  ['±','fn'],['0',''],['.',''],['=','eq'],
];

function fmt(n) {
  if (!Number.isFinite(n)) return 'Ошибка';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const r = +n.toFixed(10);
  return Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-9 && r !== 0) ? r.toExponential(6) : String(r);
}

function mount(root, win) {
  let expr = '';
  let history = settings.get('calcHistory', []) || [];

  root.innerHTML = `
    <div class="app-row">
      <div class="calc">
        <div class="calc-scr">
          <div class="calc-expr"></div>
          <div class="calc-val">0</div>
        </div>
        <div class="calc-keys"></div>
      </div>
      <div class="calc-hist">
        <div class="hd">${icon('history')}<span>История</span><button class="btn sm ghost" style="margin-left:auto;height:20px;padding:0 6px" title="Очистить">${icon('trash')}</button></div>
        <div class="items"></div>
      </div>
    </div>`;

  const exprEl = root.querySelector('.calc-expr');
  const valEl = root.querySelector('.calc-val');
  const keysEl = root.querySelector('.calc-keys');
  const itemsEl = root.querySelector('.items');

  const preview = () => {
    exprEl.textContent = expr || ' ';
    if (!expr) { valEl.textContent = '0'; return; }
    try { valEl.textContent = fmt(evalExpr(expr)); }
    catch { valEl.textContent = '…'; }
  };

  const renderHist = () => {
    itemsEl.innerHTML = '';
    if (!history.length) {
      itemsEl.appendChild(h(`<div style="padding:18px 12px;text-align:center;font-size:11px;color:var(--fg-3);line-height:1.5">Посчитай что-нибудь — результаты появятся здесь</div>`));
      return;
    }
    history.forEach((r) => {
      const b = h(`<button class="it"><div class="e">${esc(r.e)}</div><div class="r">${esc(r.r)}</div></button>`);
      b.onclick = () => { expr = r.r; preview(); sound.click(); };
      itemsEl.appendChild(b);
    });
  };

  const equals = async () => {
    if (!expr) return;
    try {
      const v = evalExpr(expr);
      const res = fmt(v);
      valEl.textContent = res;
      exprEl.textContent = expr + ' =';
      history = [{ e: expr, r: res, at: Date.now() }, ...history].slice(0, 60);
      await settings.set('calcHistory', history);
      renderHist();
      expr = res;
      sound.success();
    } catch (e) {
      valEl.textContent = 'Ошибка';
      exprEl.textContent = expr;
      notify.warn('Не могу посчитать', e.message);
      sound.error();
    }
  };

  const press = (k) => {
    sound.click();
    if (k === 'C') { expr = ''; preview(); return; }
    if (k === '=') { equals(); return; }
    if (k === '±') {
      if (!expr) return;
      expr = expr.startsWith('-') ? expr.slice(1) : '-' + expr;
      preview(); return;
    }
    expr += k;
    preview();
  };

  KEYS.forEach(([k, cls]) => {
    const b = h(`<button class="calc-k ${cls}">${k}</button>`);
    b.onclick = () => press(k);
    keysEl.appendChild(b);
  });

  root.querySelector('.calc-hist .btn').onclick = async () => {
    history = [];
    await settings.set('calcHistory', history);
    renderHist();
  };

  // клавиатура работает, когда окно в фокусе
  const onKey = (e) => {
    if (!win.isFocused()) return;
    const k = e.key;
    if (/^[\d.+\-*/()%^!]$/.test(k)) { press(k === '*' ? '×' : k === '/' ? '÷' : k === '-' ? '−' : k); e.preventDefault(); }
    else if (k === 'Enter' || k === '=') { equals(); e.preventDefault(); }
    else if (k === 'Backspace') { expr = expr.slice(0, -1); preview(); e.preventDefault(); }
    else if (k === 'Escape') { expr = ''; preview(); e.preventDefault(); }
    else if (k === ',') { press('.'); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  win.onCleanup(() => document.removeEventListener('keydown', onKey));

  preview();
  renderHist();
}

export default function register() {
  registry.register({
    id: 'calculator', name: 'Калькулятор', icon: 'calculator',
    color: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    width: 520, height: 470, minWidth: 460, minHeight: 400,
    category: 'Утилиты', desc: 'Арифметика, функции, история вычислений',
    keywords: ['calc','считать','математика','процент'],
    mount,
  });
}
