/* weather.js — погода через open-meteo (без API-ключа, CORS разрешён). */

import { settings } from '../kernel/db.js';
import registry from '../shell/registry.js';
import net from '../services/net.js';
import notify from '../services/notify.js';
import icon from '../ui/icons.js';
import { h, esc, prompt, confirm } from '../ui/dom.js';

const WMO = {
  0:  ['Ясно', 'sun'],
  1:  ['Преимущественно ясно', 'sun'],
  2:  ['Переменная облачность', 'cloud'],
  3:  ['Пасмурно', 'cloud'],
  45: ['Туман', 'fog'],
  48: ['Изморозь', 'fog'],
  51: ['Морось слабая', 'droplets'],
  53: ['Морось', 'droplets'],
  55: ['Морось сильная', 'droplets'],
  61: ['Дождь слабый', 'cloudRain'],
  63: ['Дождь', 'cloudRain'],
  65: ['Дождь сильный', 'cloudRain'],
  71: ['Снег слабый', 'cloudSnow'],
  73: ['Снег', 'cloudSnow'],
  75: ['Снег сильный', 'cloudSnow'],
  77: ['Снежные зёрна', 'cloudSnow'],
  80: ['Ливень', 'cloudRain'],
  81: ['Ливень сильный', 'cloudRain'],
  82: ['Ливень очень сильный', 'cloudRain'],
  85: ['Снегопад', 'cloudSnow'],
  86: ['Снегопад сильный', 'cloudSnow'],
  95: ['Гроза', 'cloudLightning'],
  96: ['Гроза с градом', 'cloudLightning'],
  99: ['Гроза с сильным градом', 'cloudLightning'],
};

const DAYS = ['вс','пн','вт','ср','чт','пт','сб'];
const dayName = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? 'Сегодня' : DAYS[d.getDay()];
};

function mount(root, win) {
  root.innerHTML = `<div class="wx"><div class="wx-inner"></div></div>`;
  const wrap = root.querySelector('.wx-inner');

  let city = settings.get('weatherCity', { name: 'Москва', lat: 55.7558, lon: 37.6173 });

  function loading() {
    wrap.innerHTML = `
      <div class="wx-now">
        <div class="skel" style="width:96px;height:52px"></div>
        <div class="mt">
          <div class="skel" style="height:16px;width:180px;margin-bottom:8px"></div>
          <div class="skel" style="height:12px;width:120px"></div>
        </div>
      </div>
      <div class="wx-cards">${Array(4).fill('<div class="card"><div class="skel" style="height:56px"></div></div>').join('')}</div>`;
  }

  async function load() {
    loading();
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}`
        + `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m`
        + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`
        + `&timezone=auto&forecast_days=7`;
      const j = await net.json(u);
      render(j);
    } catch (e) {
      wrap.innerHTML = '';
      wrap.appendChild(h(`
        <div class="empty" style="padding:40px">
          ${icon('alert', 'ill')}
          <h4>Не удалось получить прогноз</h4>
          <p>${esc(e.message || 'open-meteo не ответил')}</p>
          <button class="btn primary" data-a="retry">Повторить</button>
        </div>`));
      wrap.querySelector('[data-a="retry"]').onclick = load;
    }
  }

  function render(j) {
    const cur = j.current;
    const [desc, ic] = WMO[cur.weather_code] || ['—', 'cloud'];
    const days = j.daily.time.map((t, i) => ({
      t,
      code: j.daily.weather_code[i],
      hi: Math.round(j.daily.temperature_2m_max[i]),
      lo: Math.round(j.daily.temperature_2m_min[i]),
      pr: j.daily.precipitation_probability_max[i] || 0,
    }));

    const tMin = Math.min(...days.map((d) => d.lo));
    const tMax = Math.max(...days.map((d) => d.hi));

    wrap.innerHTML = `
      <div class="wx-now">
        <div class="tp">${Math.round(cur.temperature_2m)}°</div>
        <div class="mt">
          <div class="ci">${esc(city.name)}</div>
          <div class="ds">${esc(desc)}</div>
          <div class="fl">Ощущается ${Math.round(cur.apparent_temperature)}° · ветер ${Math.round(cur.wind_speed_10m)} км/ч · влажность ${cur.relative_humidity_2m}%</div>
        </div>
        <div class="ic">${icon(ic)}</div>
      </div>
      <div class="wx-cards">
        <div class="card"><h4>Ощущается</h4><div style="font-size:20px;font-weight:600">${Math.round(cur.apparent_temperature)}°</div></div>
        <div class="card"><h4>Влажность</h4><div style="font-size:20px;font-weight:600">${cur.relative_humidity_2m}%</div></div>
        <div class="card"><h4>Ветер</h4><div style="font-size:20px;font-weight:600">${Math.round(cur.wind_speed_10m)} <span style="font-size:11px;color:var(--fg-3)">км/ч</span></div></div>
        <div class="card"><h4>Осадки сегодня</h4><div style="font-size:20px;font-weight:600">${days[0]?.pr ?? 0}%</div></div>
      </div>
      <div class="wx-days"></div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-a="city">${icon('search')}<span>Сменить город</span></button>
        <button class="btn sm" data-a="refresh">${icon('refresh')}<span>Обновить</span></button>
        <span style="flex:1"></span>
        <span style="font-size:11px;color:var(--fg-3);align-self:center">Источник: open-meteo.com</span>
      </div>`;

    const daysEl = wrap.querySelector('.wx-days');
    for (const d of days) {
      const [dsc, dic] = WMO[d.code] || ['—', 'cloud'];
      const span = Math.max(1, tMax - tMin);
      const off = (d.lo - tMin) / span;
      const w = Math.max(0.05, (d.hi - d.lo) / span);
      const row = h(`
        <div class="wx-day">
          <span class="dn">${esc(dayName(d.t))}</span>
          <span class="ic">${icon(dic)}</span>
          <span class="dsc">${esc(dsc)}${d.pr ? ' · ' + d.pr + '% осадков' : ''}</span>
          <span class="rng">
            <span class="lo">${d.lo}°</span>
            <span class="track"><i style="left:${off * 100}%;width:${w * 100}%"></i></span>
            <span class="hi">${d.hi}°</span>
          </span>
        </div>`);
      daysEl.appendChild(row);
    }

    wrap.querySelector('[data-a="refresh"]').onclick = load;
    wrap.querySelector('[data-a="city"]').onclick = changeCity;
  }

  async function changeCity() {
    const q = await prompt({
      title: 'Город', value: city.name,
      message: 'Начни вводить название — найдём координаты через open-meteo geocoding.',
      validate: (v) => v.trim().length < 2 ? 'Слишком коротко' : null,
    });
    if (!q) return;
    try {
      const j = await net.json(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ru&format=json`);
      const hit = j.results?.[0];
      if (!hit) { notify.warn('Не найдено', `Город «${q}» не найден.`); return; }
      city = { name: hit.name, lat: hit.latitude, lon: hit.longitude };
      await settings.set('weatherCity', city);
      load();
    } catch (e) { notify.error('Ошибка поиска', e.message); }
  }

  win.setTitle(`Погода — ${city.name}`);
  load();
}

export default function register() {
  registry.register({
    id: 'weather', name: 'Погода', icon: 'cloud',
    color: 'linear-gradient(135deg,#0ea5e9,#0284c7)',
    width: 620, height: 620, minWidth: 420, minHeight: 360,
    category: 'Утилиты', desc: 'Прогноз на 7 дней через open-meteo',
    keywords: ['погода','weather','прогноз','температура'],
    mount,
  });
}