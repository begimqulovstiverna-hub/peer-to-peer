// Server bilan aloqa. Mini App ichida Telegram imzosi, saytda Telegram Login Widget ma'lumoti yuboriladi.
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  function authHeader() {
    if (tg && tg.initData) return 'tma ' + tg.initData;
    try { const w = localStorage.getItem('ep_tg_widget'); if (w) return 'tgw ' + encodeURIComponent(w); } catch (e) {}
    return '';
  }
  async function call(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: authHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Xatolik'); e.status = res.status; throw e; }
    return data;
  }
  window.EP_API = {
    inTelegram: !!(tg && tg.initData),
    call,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b || {}),
    patch: (p, b) => call('PATCH', p, b || {}),
    del: (p) => call('DELETE', p),
  };
})();
