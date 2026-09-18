/* proxy.js — Cloudflare Worker: принимает ?url=<encoded>, отдаёт содержимое с CORS-заголовками.
   Разверни у себя: `wrangler deploy worker/proxy.js --name browsec-proxy`.
   Никаких секретов, ничего не логирует, работает только на чтение. */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    const target = url.searchParams.get('url');
    if (!target) {
      return json({ ok: false, error: 'Нужен ?url=<encoded>' }, 400);
    }

    let u;
    try { u = new URL(target); }
    catch { return json({ ok: false, error: 'Плохой URL' }, 400); }

    if (!/^https?:$/.test(u.protocol)) {
      return json({ ok: false, error: 'Только http и https' }, 400);
    }

    // запрещаем внутренние адреса (защита от SSRF)
    const host = u.hostname.toLowerCase();
    if (isPrivateHost(host)) {
      return json({ ok: false, error: 'Внутренние адреса запрещены' }, 403);
    }

    const init = {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: {
        'User-Agent': 'Browsec-Proxy/1.0 (+https://example.invalid)',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
        'Accept-Language': request.headers.get('accept-language') || 'ru,en;q=0.7',
      },
      redirect: 'follow',
      cf: { cacheTtl: 60, cacheEverything: true },
    };

    let upstream;
    try {
      upstream = await fetch(u.href, init);
    } catch (e) {
      return json({ ok: false, error: 'Upstream: ' + (e.message || 'fetch failed') }, 502);
    }

    // отфильтрованные заголовки
    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    headers.set('Access-Control-Allow-Headers', '*');
    headers.set('Cache-Control', 'public, max-age=60');

    const ct = upstream.headers.get('content-type') || '';
    if (ct) headers.set('Content-Type', ct);

    // не пропускаем куки и заголовки авторизации
    const drop = new Set(['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding',
      'strict-transport-security', 'content-security-policy', 'x-frame-options']);
    upstream.headers.forEach((v, k) => {
      if (!drop.has(k.toLowerCase())) headers.set(k, v);
    });

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function isPrivateHost(h) {
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (h === '::1' || h === '[::1]') return true;
  return false;
}