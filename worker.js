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

// Moderator beradigan nishonlar (peers.txt)
const AWARD_BADGES = {
  writer: { title: 'Mohir yozuvchi', xp: 300 },
  speaker: { title: 'So‘zlovchi', xp: 800 },
  listener: { title: 'Tinglovchi', xp: 500 },
};
const MAX_FILE_CHARS = 1_000_000; // base64 matn uzunligi (~700 KB fayl)

async function sendTelegram(env, chatId, text, origin) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: [[{ text: 'English Peersni ochish', web_app: { url: origin } }]] },
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const isModRow = (row) => !!row && (row.role === 'super_admin' || (row.role === 'temp_moderator' && Number(row.mod_expires) > Date.now()));

async function notify(env, userId, fromId, kind, text, origin) {
  await env.DB.prepare('INSERT INTO notifications(user_id, from_id, kind, text) VALUES(?, ?, ?, ?)').bind(userId, fromId, kind, text).run();
  await sendTelegram(env, userId, text, origin);
}

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
        const nick = String(p.nickname || '').replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(nick)) {
          return json({ error: 'Nickname 3–20 ta lotin harfi, raqam yoki _ bo‘lishi kerak' }, 400);
        }
        p.nickname = nick;
        try {
          await env.DB.prepare('UPDATE users SET profile_json = ?, nickname = ? WHERE telegram_id = ?')
            .bind(JSON.stringify(p), nick, tgId).run();
        } catch (e) {
          if (/UNIQUE/i.test(String(e && e.message))) return json({ error: 'Bu nickname band, boshqasini tanlang' }, 409);
          throw e;
        }
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

      // ---- Tengdoshga fikr: nickname egasiga bildirishnoma ----
      if (path === '/api/reviews' && request.method === 'POST') {
        const b = await readBody(request);
        const target = String(b.target || '').replace(/^@/, '').toLowerCase();
        const wentWell = String(b.wentWell || '').slice(0, 500);
        const toImprove = String(b.toImprove || '').slice(0, 500);
        if (!target || !wentWell) return json({ error: 'Nickname va fikr matnini yozing' }, 400);

        const author = await env.DB.prepare('SELECT nickname, profile_json FROM users WHERE telegram_id = ?').bind(tgId).first();
        if (!author || !author.nickname) return json({ error: 'Avval profilingizda nickname bo‘lishi kerak' }, 400);
        if (author.nickname === target) return json({ error: 'O‘zingizga fikr bildirib bo‘lmaydi' }, 400);

        const recent = await env.DB.prepare(
          "SELECT COUNT(*) AS c FROM notifications WHERE from_id = ? AND created_at > datetime('now','-1 hour')"
        ).bind(tgId).first();
        if (recent && recent.c >= 10) return json({ error: 'Juda ko‘p fikr yubordingiz, birozdan keyin urinib ko‘ring' }, 429);

        const rcpt = await env.DB.prepare('SELECT telegram_id FROM users WHERE nickname = ?').bind(target).first();
        if (!rcpt) return json({ error: `@${target} nickname topilmadi` }, 404);

        let authorName = '@' + author.nickname;
        const text = `🌟 ${authorName} sizga fikr bildirdi:\n\nZo‘r tomoni: ${wentWell}` + (toImprove ? `\nYaxshilash mumkin: ${toImprove}` : '');
        await env.DB.prepare('INSERT INTO notifications(user_id, from_id, kind, text) VALUES(?, ?, ?, ?)')
          .bind(rcpt.telegram_id, tgId, 'review', text).run();

        let notified = false;
        try {
          const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: rcpt.telegram_id,
              text,
              reply_markup: { inline_keyboard: [[{ text: 'English Peersni ochish', web_app: { url: url.origin } }]] },
            }),
          });
          notified = r.ok;
        } catch {}
        return json({ ok: true, notified });
      }

      if (path === '/api/notifications' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, kind, text, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30'
        ).bind(tgId).all();
        const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').bind(tgId).first();
        return json({ items: results || [], unread: cnt ? cnt.c : 0 });
      }

      if (path === '/api/notifications/read' && request.method === 'POST') {
        await env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').bind(tgId).run();
        return json({ ok: true });
      }

      // ---- Uy vazifasi: o‘quvchi → moderator tekshiradi → o‘quvchi 1 marta javob beradi ----
      if (path.startsWith('/api/homework')) {
        const me = await env.DB.prepare('SELECT telegram_id, role, mod_expires, nickname, profile_json FROM users WHERE telegram_id = ?').bind(tgId).first();
        if (!me) return json({ error: 'Foydalanuvchi topilmadi' }, 404);
        const myProfile = parse(me.profile_json) || {};
        const myName = myProfile.fullName || (me.nickname ? '@' + me.nickname : 'Foydalanuvchi');
        const mod = isModRow(me);

        if (path === '/api/homework' && request.method === 'GET') {
          const q = mod
            ? env.DB.prepare('SELECT * FROM homework ORDER BY id DESC LIMIT 100')
            : env.DB.prepare('SELECT * FROM homework WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(tgId);
          const { results } = await q.all();
          return json({
            items: (results || []).map((r) => ({
              id: String(r.id), userName: r.user_name, lessonTitle: r.lesson_title, answerText: r.answer_text,
              status: r.status, mentorComment: r.mentor_comment || '', mentorName: r.mentor_name || '',
              userFeedback: r.user_feedback || '', mine: r.user_id === tgId,
              hasFile: !!r.file_kind, fileKind: r.file_kind || '', fileName: r.file_name || '',
              badge: r.badge || '', badgeXp: r.badge_xp || 0,
            })),
          });
        }

        if (path === '/api/homework' && request.method === 'POST') {
          const b = await readBody(request);
          const lessonTitle = String(b.lessonTitle || '').slice(0, 200);
          const answerText = String(b.answerText || '').trim().slice(0, 3000);
          const f = b.file && typeof b.file === 'object' ? b.file : null;
          let fileKind = null, fileName = null, fileMime = null, fileData = null;
          if (f) {
            fileMime = String(f.mime || '');
            fileData = String(f.data || '');
            fileName = String(f.name || 'fayl').slice(0, 120);
            if (!/^data:[\w.+\/-]+;base64,/.test(fileData)) return json({ error: 'Fayl formati noto‘g‘ri' }, 400);
            if (fileData.length > MAX_FILE_CHARS) return json({ error: 'Fayl juda katta (700 KB gacha)' }, 413);
            if (fileMime.startsWith('video/')) return json({ error: 'Video yuklab bo‘lmaydi' }, 400);
            fileKind = fileMime.startsWith('image/') ? 'image' : fileMime.startsWith('audio/') ? 'audio' : 'file';
          }
          if (!answerText && !f) return json({ error: 'Vazifa matnini yozing yoki fayl biriktiring' }, 400);
          const res = await env.DB.prepare('INSERT INTO homework(user_id, user_name, lesson_title, answer_text, file_kind, file_name) VALUES(?, ?, ?, ?, ?, ?)')
            .bind(tgId, myName, lessonTitle, answerText, fileKind, fileName).run();
          if (f) {
            await env.DB.prepare('INSERT INTO homework_files(homework_id, mime, data) VALUES(?, ?, ?)')
              .bind(res.meta.last_row_id, fileMime, fileData).run();
          }
          // Moderatorlarga bildirishnoma
          const { results: mods } = await env.DB.prepare(
            "SELECT telegram_id FROM users WHERE role = 'super_admin' OR (role = 'temp_moderator' AND mod_expires > ?) LIMIT 20"
          ).bind(Date.now()).all();
          for (const m of mods || []) {
            if (m.telegram_id !== tgId) await notify(env, m.telegram_id, tgId, 'homework', `📝 ${myName} uy vazifasi topshirdi: ${lessonTitle}. Tekshirish kerak.`, url.origin);
          }
          return json({ ok: true, id: String(res.meta.last_row_id) });
        }

        if (path === '/api/homework/file' && request.method === 'GET') {
          const id = Number(url.searchParams.get('id'));
          const row = await env.DB.prepare('SELECT user_id, file_name FROM homework WHERE id = ?').bind(id).first();
          if (!row || (row.user_id !== tgId && !mod)) return json({ error: 'Fayl topilmadi' }, 404);
          const file = await env.DB.prepare('SELECT mime, data FROM homework_files WHERE homework_id = ?').bind(id).first();
          if (!file) return json({ error: 'Fayl topilmadi' }, 404);
          return json({ name: row.file_name || 'fayl', mime: file.mime, data: file.data });
        }

        if (path === '/api/homework/review' && request.method === 'POST') {
          if (!mod) return json({ error: 'Vazifani faqat moderator tekshira oladi' }, 403);
          const b = await readBody(request);
          const comment = String(b.comment || '').trim().slice(0, 1500);
          if (!comment) return json({ error: 'Izoh yozing' }, 400);
          const row = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(Number(b.id)).first();
          if (!row) return json({ error: 'Vazifa topilmadi' }, 404);
          if (row.user_id === tgId) return json({ error: 'O‘z vazifangizni o‘zingiz tekshira olmaysiz' }, 403);
          if (row.status === 'Reviewed') return json({ error: 'Bu vazifa allaqachon tekshirilgan' }, 409);
          const award = AWARD_BADGES[b.badge] || null;
          await env.DB.prepare("UPDATE homework SET status = 'Reviewed', mentor_comment = ?, mentor_name = ?, mentor_id = ?, badge = ?, badge_xp = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(comment, myName, tgId, award ? b.badge : null, award ? award.xp : null, row.id).run();
          await notify(env, row.user_id, tgId, 'homework_review',
            `✅ Vazifangiz tekshirildi (${row.lesson_title}). Moderator izohi: ${comment}` + (award ? `\n🏅 Nishon: ${award.title} (+${award.xp} XP)` : ''), url.origin);
          return json({ ok: true });
        }

        if (path === '/api/homework/feedback' && request.method === 'POST') {
          const b = await readBody(request);
          const text = String(b.text || '').trim().slice(0, 1000);
          if (!text) return json({ error: 'Javob matnini yozing' }, 400);
          const row = await env.DB.prepare('SELECT * FROM homework WHERE id = ?').bind(Number(b.id)).first();
          if (!row || row.user_id !== tgId) return json({ error: 'Vazifa topilmadi' }, 404);
          if (row.status !== 'Reviewed') return json({ error: 'Avval moderator tekshirishi kerak' }, 409);
          if (row.user_feedback) return json({ error: 'Javobni faqat 1 marta yuborish mumkin' }, 409);
          await env.DB.prepare('UPDATE homework SET user_feedback = ? WHERE id = ?').bind(text, row.id).run();
          if (row.mentor_id) await notify(env, row.mentor_id, tgId, 'homework_feedback', `💬 ${myName} vazifa izohingizga javob yozdi: ${text}`, url.origin);
          return json({ ok: true });
        }
      }

      return json({ error: 'Topilmadi' }, 404);
    } catch (e) {
      return json({ error: e.status ? e.message : 'Server xatosi' }, e.status || 500);
    }
  },
};
