// English Peers — Cloudflare Worker + D1 backend (server.js ning Worker versiyasi)
// API shartnomasi frontend (api.js) bilan bir xil: /api/auth/telegram, /api/state, /api/profile, /api/moderator/activate, /health

const enc = new TextEncoder();
const MAX_BODY = 1_500_000; // D1 qatori ~2 MB bilan cheklangan

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(keyData, message) {
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function validateTelegramInitData(initData, botToken) {
  if (!botToken || !initData) throw new Error('Telegram bot token yoki initData yo‘q');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Telegram initData hash yo‘q');
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const expected = hex(await hmac(secret, dataCheck));
  if (!safeEqual(hash, expected)) throw new Error('Telegram imzo tekshiruvi muvaffaqiyatsiz');
  const authDate = Number(params.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > 86400) throw new Error('Telegram sessiyasi eskirgan');
  const user = JSON.parse(params.get('user') || '{}');
  if (!user.id) throw new Error('Telegram foydalanuvchisi topilmadi');
  return user;
}

// Workers holatsiz (stateless), shuning uchun sessiya tokeni imzolangan: <payload>.<imzo>
async function signToken(tgId, env) {
  const payload = b64u(enc.encode(JSON.stringify({ id: tgId, exp: Date.now() + 7 * 86400_000 })));
  const sig = b64u(await hmac(enc.encode(env.BOT_TOKEN), 'ep-session:' + payload));
  return `${payload}.${sig}`;
}

async function readToken(req, env) {
  const raw = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/, '');
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || !env.BOT_TOKEN) return null;
  const expected = b64u(await hmac(enc.encode(env.BOT_TOKEN), 'ep-session:' + payload));
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return data.exp > Date.now() ? String(data.id) : null;
  } catch {
    return null;
  }
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('Ma’lumot juda katta'), { status: 413 });
  return text ? JSON.parse(text) : {};
}

const parse = (s) => (s ? JSON.parse(s) : null);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/') && path !== '/health') {
      return env.ASSETS.fetch(request); // sayt fayllari (index.html, api.js ...)
    }

    try {
      if (path === '/health') return json({ ok: true });

      if (path === '/api/auth/telegram' && request.method === 'POST') {
        const body = await readBody(request);
        let user;
        try {
          user = await validateTelegramInitData(body.initData, env.BOT_TOKEN);
        } catch (e) {
          return json({ error: e.message }, 401);
        }
        const id = String(user.id);
        await env.DB.prepare(
          'INSERT INTO users(telegram_id, username) VALUES(?1, ?2) ON CONFLICT(telegram_id) DO UPDATE SET username = ?2'
        ).bind(id, user.username || '').run();
        const row = await env.DB.prepare(
          'SELECT profile_json, state_json, role, mod_expires FROM users WHERE telegram_id = ?'
        ).bind(id).first();
        return json({
          token: await signToken(id, env),
          user,
          profile: parse(row.profile_json),
          state: parse(row.state_json),
          role: row.role,
          modExpires: row.mod_expires,
        });
      }

      // Quyidagi barcha yo‘llar avtorizatsiya talab qiladi
      const tgId = await readToken(request, env);
      if (!tgId) return json({ error: 'Avtorizatsiya talab qilinadi' }, 401);

      if (path === '/api/state' && request.method === 'GET') {
        const row = await env.DB.prepare(
          'SELECT profile_json, state_json, role, mod_expires FROM users WHERE telegram_id = ?'
        ).bind(tgId).first();
        if (!row) return json({ error: 'Foydalanuvchi topilmadi' }, 404);
        const state = parse(row.state_json) || {};
        return json({ ...state, profile: parse(row.profile_json) || state.profile || null, role: row.role, modExpires: row.mod_expires });
      }

      if (path === '/api/state' && request.method === 'PUT') {
        const body = await readBody(request);
        const profile = body.profile || null;
        const state = { ...body };
        delete state.profile;
        await env.DB.prepare('UPDATE users SET profile_json = ?, state_json = ? WHERE telegram_id = ?')
          .bind(profile ? JSON.stringify(profile) : null, JSON.stringify(state), tgId).run();
        return json({ ok: true });
      }

      if (path === '/api/profile' && request.method === 'PUT') {
        const p = await readBody(request);
        if (!p.fullName || !p.group || !p.level) return json({ error: 'Profil ma’lumotlari to‘liq emas' }, 400);
        await env.DB.prepare('UPDATE users SET profile_json = ? WHERE telegram_id = ?')
          .bind(JSON.stringify(p), tgId).run();
        return json({ ok: true, profile: p });
      }

      if (path === '/api/moderator/activate' && request.method === 'POST') {
        const body = await readBody(request);
        const key = String(body.key || '');
        const master = env.MASTER_KEY || '';
        const mod = env.MODERATOR_KEY || '';
        // Bo‘sh kalit hech qachon mos kelmasin
        const role = master && safeEqual(key, master) ? 'super_admin' : mod && safeEqual(key, mod) ? 'temp_moderator' : null;
        if (!role) return json({ valid: false, error: 'Kalit noto‘g‘ri' }, 403);
        const minutes = Number(env.MODERATOR_MINUTES || 60);
        const expires = role === 'temp_moderator' ? Date.now() + minutes * 60000 : null;
        await env.DB.batch([
          env.DB.prepare('UPDATE users SET role = ?, mod_expires = ? WHERE telegram_id = ?').bind(role, expires, tgId),
          env.DB.prepare('INSERT INTO audit(telegram_id, action) VALUES(?, ?)').bind(tgId, `Moderator role: ${role}`),
        ]);
        return json({ valid: true, role, expiresAt: expires });
      }

      return json({ error: 'Topilmadi' }, 404);
    } catch (e) {
      return json({ error: e.status ? e.message : 'Server xatosi' }, e.status || 500);
    }
  },
};
