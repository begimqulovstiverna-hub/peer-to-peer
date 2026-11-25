// English Peers — Cloudflare Worker: API + Telegram bot + eslatmalar (cron)
const DAY = 86400000;
const XP = { REGISTER: 50, ABSENT: -80, SPEAKER_CANCEL: -90, SPEAKER_DONE: 300, VOCAB_WORD: 3, TEST_GREEN: 50 };
const BADGES = {
  member: { title: 'Klub a’zosi', xp: 0 },
  first_speaking: { title: 'Dastlabki speakerlik', xp: 200 },
  real_student: { title: 'Haqiqiy o‘quvchi', xp: 70 },
  goal_getter: { title: 'Maqsad sari boruvchi', xp: 140 },
  listener: { title: 'Tinglovchi', xp: 500 },
  writer: { title: 'Mohir yozuvchi', xp: 300 },
  speaker: { title: 'So‘zlovchi', xp: 800 },
  helper: { title: 'Ko‘makchi', xp: 100 },
};
const SUBMISSION_BADGE = { writing: 'writer', speaking: 'speaker', listening: 'listener' };
const REMINDER_WINDOWS = [1440, 360, 120, 30]; // dars boshlanishigacha, daqiqada
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const EXPERIENCES = ['speaking', 'reading', 'writing', 'listening', 'talaffuz', 'lugat', 'tajriba yoq'];
const GROUPS = {
  101: 'Axborot tizimlari va texnologiyalari', 102: 'Sun’iy intellekt',
  103: 'Matematika', 104: 'Matematika', 105: 'Matematika', 106: 'Oliy matematika', 107: 'Oliy matematika',
};

// ---------- yordamchilar ----------
const enc = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const err = (status, message) => json({ error: message }, status);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const safeEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const isMod = (u) => !!u && (u.role === 'super_admin' || (u.role === 'moderator' && (u.mod_until || 0) > Date.now()));
const isSuper = (u) => !!u && u.role === 'super_admin';
const tashkent = (ms) => { const d = new Date(ms + 5 * 3600000); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const modOnly = (u) => (isMod(u) ? null : err(403, 'Faqat moderator uchun'));

async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
async function sha256hex(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

// ---------- Telegram autentifikatsiya ----------
// Mini App: Authorization: tma <initData>
export async function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  if (!safeEq(hex(await hmac(secret, dcs)), hash)) return null;
  if (Date.now() - Number(params.get('auth_date') || 0) * 1000 > DAY) return null;
  try { const u = JSON.parse(params.get('user')); return { id: u.id, first_name: u.first_name, last_name: u.last_name, username: u.username }; } catch { return null; }
}
// Sayt: Authorization: tgw <encodeURIComponent(JSON)>  (Telegram Login Widget ma'lumoti)
async function verifyWidget(raw, botToken) {
  let d; try { d = JSON.parse(decodeURIComponent(raw)); } catch { return null; }
  const { hash, ...rest } = d;
  if (!hash) return null;
  const dcs = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  if (!safeEq(hex(await hmac(secret, dcs)), hash)) return null;
  if (Date.now() - Number(rest.auth_date || 0) * 1000 > DAY) return null;
  return { id: rest.id, first_name: rest.first_name, last_name: rest.last_name, username: rest.username };
}
async function getUser(req, env) {
  const h = req.headers.get('authorization') || '';
  let tg = null;
  if (h.startsWith('tma ')) tg = await verifyInitData(h.slice(4), env.BOT_TOKEN);
  else if (h.startsWith('tgw ')) tg = await verifyWidget(h.slice(4), env.BOT_TOKEN);
  if (!tg) return { tg: null, user: null };
  const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(tg.id).first();
  return { tg, user };
}

// ---------- Telegram yuborish, XP, nishon, bildirishnoma ----------
async function tgSend(env, chatId, text, extra = {}) {
  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
    });
  } catch (e) { console.error('tgSend', e); }
}
async function notify(env, userId, text) {
  await env.DB.prepare('INSERT INTO notifications (user_id,text,created_at) VALUES (?,?,?)').bind(userId, text, Date.now()).run();
  await tgSend(env, userId, esc(text));
}
async function notifyMods(env, text) {
  const mods = (await env.DB.prepare(`SELECT id FROM users WHERE role='super_admin' OR (role='moderator' AND mod_until>?)`).bind(Date.now()).all()).results;
  for (const m of mods) await notify(env, m.id, text);
}
async function addXp(env, userId, delta, reason) {
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET xp = xp + ? WHERE id=?').bind(delta, userId),
    env.DB.prepare('INSERT INTO xp_log (user_id,delta,reason,created_at) VALUES (?,?,?,?)').bind(userId, delta, reason, Date.now()),
  ]);
}
async function awardBadge(env, userId, badgeId) {
  const b = BADGES[badgeId];
  if (!b) return false;
  const r = await env.DB.prepare('INSERT OR IGNORE INTO badges (user_id,badge_id,awarded_at) VALUES (?,?,?)').bind(userId, badgeId, Date.now()).run();
  if (!r.meta.changes) return false;
  if (b.xp) {
    await addXp(env, userId, b.xp, `Nishon: ${b.title}`);
    await notify(env, userId, `🏅 Yangi nishon: ${b.title} (+${b.xp} XP)`);
  }
  return true;
}
async function audit(env, userId, action) {
  await env.DB.prepare('INSERT INTO audit (user_id,action,created_at) VALUES (?,?,?)').bind(userId, action, Date.now()).run();
}

// ---------- Kalitlar (moderator tizimi) ----------
async function getKeys(env) {
  const rows = (await env.DB.prepare('SELECT key,value FROM settings').all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!s.master_hash) {
    s.master_hash = await sha256hex('m:' + (env.INITIAL_MASTER_KEY || crypto.randomUUID()));
    s.temp_hash = await sha256hex('t:' + (env.INITIAL_MOD_KEY || crypto.randomUUID()));
    s.temp_minutes = '60'; s.key_version = '1';
    await env.DB.batch(Object.entries(s).map(([k, v]) => env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(k, v)));
  }
  return s;
}
async function setSetting(env, k, v) { await env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(k, String(v)).run(); }

// ---------- Router ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/bot' && req.method === 'POST') return await handleBot(req, env);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) { console.error(e); return err(500, 'Server xatosi'); }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(sendReminders(env)); },
};

// ---------- Telegram bot webhook ----------
async function handleBot(req, env) {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  const upd = await req.json().catch(() => ({}));
  const msg = upd.message;
  if (msg?.text) {
    const kb = { inline_keyboard: [[{ text: '📚 English Peers’ni ochish', web_app: { url: env.APP_URL } }]] };
    await tgSend(env, msg.chat.id, 'Salom! 👋 <b>English Peers</b> — bepul ingliz tili klubi.\nDarslar, testlar va XP uchun pastdagi tugmani bosing.', { reply_markup: kb });
  }
  return new Response('ok');
}

// ---------- API ----------
async function handleApi(req, env, url) {
  const m = req.method;
  const p = url.pathname.replace(/^\/api/, '');
  const { tg, user } = await getUser(req, env);
  if (!tg) return err(401, 'Telegram orqali kiring');
  const body = async () => req.json().catch(() => ({}));
  let x;

  if (p === '/me' && m === 'GET') return json({ user: user ? await publicUser(env, user) : null, tg });
  if (p === '/register' && m === 'POST') return register(env, tg, user, await body());
  if (!user) return err(403, 'Avval ro‘yxatdan o‘ting');

  if (p === '/me' && m === 'PATCH') {
    const b = await body();
    if (typeof b.notify === 'boolean') await env.DB.prepare('UPDATE users SET notify=? WHERE id=?').bind(b.notify ? 1 : 0, user.id).run();
    if (b.level && LEVELS.includes(b.level)) await env.DB.prepare('UPDATE users SET level=? WHERE id=?').bind(b.level, user.id).run();
    if (Array.isArray(b.experiences)) await env.DB.prepare('UPDATE users SET experiences=? WHERE id=?').bind(JSON.stringify(b.experiences.filter((e) => EXPERIENCES.includes(e))), user.id).run();
    return json({ user: await publicUser(env, await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first()) });
  }
  if (p === '/claim-role' && m === 'POST') return claimRole(env, user, await body());

  // --- darslar ---
  if (p === '/schedules' && m === 'GET') return listSchedules(env, user);
  if (p === '/schedules' && m === 'POST') return modOnly(user) || createSchedule(env, user, await body());
  if ((x = p.match(/^\/schedules\/(\d+)$/)) && m === 'PATCH') return modOnly(user) || updateSchedule(env, user, +x[1], await body());
  if ((x = p.match(/^\/schedules\/(\d+)\/rsvp$/)) && m === 'POST') return rsvp(env, user, +x[1], await body());
  if ((x = p.match(/^\/schedules\/(\d+)\/rsvp$/)) && m === 'DELETE') return unrsvp(env, user, +x[1]);
  if ((x = p.match(/^\/schedules\/(\d+)\/speaker$/)) && m === 'DELETE') return cancelSpeaker(env, user, +x[1]);
  if ((x = p.match(/^\/schedules\/(\d+)\/speaker-done$/)) && m === 'POST') return modOnly(user) || speakerDone(env, +x[1]);
  if ((x = p.match(/^\/schedules\/(\d+)\/attendance$/)) && m === 'POST') return modOnly(user) || markAttendance(env, +x[1], await body());
  if ((x = p.match(/^\/schedules\/(\d+)\/test$/)) && m === 'POST') return gradeTest(env, user, +x[1], await body());

  // --- e'lonlar ---
  if (p === '/announcements' && m === 'GET') return json({ announcements: (await env.DB.prepare('SELECT id,body,created_at,expires_at FROM announcements WHERE expires_at>? ORDER BY id DESC').bind(Date.now()).all()).results });
  if (p === '/announcements' && m === 'POST') {
    const d = modOnly(user); if (d) return d;
    const b = await body(); const text = clip(b.body, 3000);
    if (!text) return err(400, 'Matn bo‘sh');
    await env.DB.prepare('INSERT INTO announcements (body,created_by,created_at,expires_at) VALUES (?,?,?,?)').bind(text, user.id, Date.now(), Date.now() + 7 * DAY).run();
    return json({ ok: true });
  }

  // --- tengdoshga fikr ---
  if (p === '/feedback' && m === 'GET') {
    const inbox = (await env.DB.prepare('SELECT f.id,f.body,f.reply,f.created_at,u.nickname AS from_nickname FROM peer_feedback f JOIN users u ON u.id=f.from_id WHERE f.to_id=? ORDER BY f.id DESC LIMIT 50').bind(user.id).all()).results;
    const sent = (await env.DB.prepare('SELECT f.id,f.body,f.reply,f.created_at,u.nickname AS to_nickname FROM peer_feedback f JOIN users u ON u.id=f.to_id WHERE f.from_id=? ORDER BY f.id DESC LIMIT 50').bind(user.id).all()).results;
    return json({ inbox, sent });
  }
  if (p === '/feedback' && m === 'POST') {
    const b = await body(); const nick = clip(b.nickname, 20).replace(/^@/, ''); const text = clip(b.body, 1000);
    const to = await env.DB.prepare('SELECT id FROM users WHERE nickname=?').bind(nick).first();
    if (!to) return err(404, 'Bunday nickname topilmadi');
    if (to.id === user.id) return err(400, 'O‘zingizga fikr yozib bo‘lmaydi');
    if (!text) return err(400, 'Fikr matni bo‘sh');
    await env.DB.prepare('INSERT INTO peer_feedback (from_id,to_id,body,created_at) VALUES (?,?,?,?)').bind(user.id, to.id, text, Date.now()).run();
    await notify(env, to.id, `💬 Sizga tengdoshingizdan yangi fikr keldi (@${user.nickname})`);
    return json({ ok: true });
  }
  if ((x = p.match(/^\/feedback\/(\d+)\/reply$/)) && m === 'POST') {
    const f = await env.DB.prepare('SELECT * FROM peer_feedback WHERE id=? AND to_id=?').bind(+x[1], user.id).first();
    const text = clip((await body()).text, 1000);
    if (!f) return err(404, 'Topilmadi');
    if (f.reply) return err(409, 'Javob faqat 1 marta qaytariladi');
    if (!text) return err(400, 'Matn bo‘sh');
    await env.DB.prepare('UPDATE peer_feedback SET reply=?, replied_at=? WHERE id=?').bind(text, Date.now(), f.id).run();
    await notify(env, f.from_id, `↩️ Fikringizga @${user.nickname} javob qaytardi`);
    return json({ ok: true });
  }

  // --- topshiriqlar (uy vazifa, writing, speaking, listening) ---
  if (p === '/submissions' && m === 'GET') {
    const q = isMod(user)
      ? env.DB.prepare('SELECT s.*, u.full_name, u.nickname FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 200')
      : env.DB.prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 100').bind(user.id);
    return json({ submissions: (await q.all()).results });
  }
  if (p === '/submissions' && m === 'POST') {
    const b = await body();
    if (!['homework', 'writing', 'speaking', 'listening'].includes(b.kind)) return err(400, 'Noto‘g‘ri tur');
    const text = clip(b.text, 8000), fileKey = b.file_key ? clip(b.file_key, 300) : null;
    if (!text && !fileKey) return err(400, 'Matn yoki fayl kerak');
    if (fileKey && !fileKey.startsWith(user.id + '/')) return err(403, 'Fayl sizniki emas');
    await env.DB.prepare('INSERT INTO submissions (user_id,kind,schedule_id,text,file_key,created_at) VALUES (?,?,?,?,?,?)').bind(user.id, b.kind, b.schedule_id || null, text, fileKey, Date.now()).run();
    await notifyMods(env, `📥 Yangi topshiriq (${b.kind}) — @${user.nickname}`);
    return json({ ok: true });
  }
  if ((x = p.match(/^\/submissions\/(\d+)\/review$/)) && m === 'POST') {
    const d = modOnly(user); if (d) return d;
    const b = await body();
    const s = await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(+x[1]).first();
    if (!s) return err(404, 'Topilmadi');
    if (!['approved', 'rejected'].includes(b.verdict)) return err(400, 'Natija noto‘g‘ri');
    await env.DB.prepare(`UPDATE submissions SET status='reviewed', verdict=?, feedback=?, reviewed_at=? WHERE id=?`).bind(b.verdict, clip(b.feedback, 3000), Date.now(), s.id).run();
    await notify(env, s.user_id, b.verdict === 'approved' ? '✅ Topshirig‘ingiz tekshirildi: qabul qilindi' : '📝 Topshirig‘ingiz tekshirildi: tavsiyalarni ko‘ring');
    if (b.verdict === 'approved' && SUBMISSION_BADGE[s.kind]) await awardBadge(env, s.user_id, SUBMISSION_BADGE[s.kind]);
    return json({ ok: true });
  }
  if ((x = p.match(/^\/submissions\/(\d+)\/reply$/)) && m === 'POST') {
    const s = await env.DB.prepare('SELECT * FROM submissions WHERE id=? AND user_id=?').bind(+x[1], user.id).first();
    const text = clip((await body()).text, 2000);
    if (!s || s.status !== 'reviewed') return err(404, 'Hali tekshirilmagan');
    if (s.user_reply) return err(409, 'Javob faqat 1 marta qaytariladi');
    if (!text) return err(400, 'Matn bo‘sh');
    await env.DB.prepare('UPDATE submissions SET user_reply=? WHERE id=?').bind(text, s.id).run();
    await notifyMods(env, `↩️ @${user.nickname} topshiriq bo‘yicha javob qaytardi`);
    return json({ ok: true });
  }
  if (p === '/admin/award' && m === 'POST') { // masalan: Ko'makchi nishoni
    const d = modOnly(user); if (d) return d;
    const b = await body();
    return json({ awarded: await awardBadge(env, +b.user_id, b.badge_id) });
  }

  // --- lug'at fleshkarta ---
  if (p === '/vocab' && m === 'GET') return json({ cards: (await env.DB.prepare('SELECT v.id,v.word,v.translation,u.nickname FROM vocab_cards v JOIN users u ON u.id=v.user_id ORDER BY v.id DESC LIMIT 500').all()).results });
  if (p === '/vocab' && m === 'POST') {
    const b = await body(); const word = clip(b.word, 60), tr = clip(b.translation, 120);
    if (!word || !tr) return err(400, 'So‘z va tarjima kerak');
    const dayStart = Math.floor((Date.now() + 5 * 3600000) / DAY) * DAY - 5 * 3600000; // Toshkent kuni
    const c = await env.DB.prepare('SELECT COUNT(*) c FROM vocab_cards WHERE user_id=? AND created_at>=?').bind(user.id, dayStart).first();
    if (c.c >= 10) return err(429, 'Kuniga 10 tadan ko‘p so‘z qo‘shib bo‘lmaydi');
    await env.DB.prepare('INSERT INTO vocab_cards (user_id,word,translation,created_at) VALUES (?,?,?,?)').bind(user.id, word, tr, Date.now()).run();
    await addXp(env, user.id, XP.VOCAB_WORD, 'Lug‘atga so‘z qo‘shildi');
    return json({ ok: true, xp: XP.VOCAB_WORD });
  }

  // --- bildirishnomalar ---
  if (p === '/notifications' && m === 'GET') return json({ notifications: (await env.DB.prepare('SELECT id,text,read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').bind(user.id).all()).results });
  if (p === '/notifications/read' && m === 'POST') { await env.DB.prepare('UPDATE notifications SET read=1 WHERE user_id=?').bind(user.id).run(); return json({ ok: true }); }

  // --- super admin ---
  if (p === '/admin/keys' && m === 'GET') {
    if (!isSuper(user)) return err(403, 'Faqat bosh tashkilotchi');
    const s = await getKeys(env);
    const logs = (await env.DB.prepare('SELECT a.action,a.created_at,u.full_name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 20').all()).results;
    return json({ temp_minutes: +s.temp_minutes, key_version: +s.key_version, logs });
  }
  if (p === '/admin/keys' && m === 'POST') {
    if (!isSuper(user)) return err(403, 'Faqat bosh tashkilotchi');
    const b = await body(); await getKeys(env);
    if (b.temp_key) { // moderator kaliti almashsa — eski kalit bilan olingan barcha moderatorliklar darhol bekor
      await setSetting(env, 'temp_hash', await sha256hex('t:' + clip(b.temp_key, 100)));
      await env.DB.prepare(`UPDATE users SET role='member', mod_until=NULL WHERE role='moderator'`).run();
    }
    if (b.master_key) {
      await setSetting(env, 'master_hash', await sha256hex('m:' + clip(b.master_key, 100)));
      await env.DB.prepare(`UPDATE users SET role='member' WHERE role='super_admin' AND id<>?`).bind(user.id).run();
    }
    if (b.temp_minutes) await setSetting(env, 'temp_minutes', Math.min(1440, Math.max(5, +b.temp_minutes || 60)));
    const s = await getKeys(env); await setSetting(env, 'key_version', +s.key_version + 1);
    await audit(env, user.id, 'Kalit sozlamalari o‘zgartirildi');
    return json({ ok: true });
  }

  // --- fayl yuklash (R2 yoqilgan bo'lsa) ---
  if (p === '/upload' && m === 'PUT') {
    if (!env.FILES) return err(501, 'Fayl saqlash hali yoqilmagan');
    if (+(req.headers.get('content-length') || 0) > 20 * 1024 * 1024) return err(413, 'Fayl 20 MB dan oshmasin');
    const name = clip(url.searchParams.get('name') || 'file', 80).replace(/[^\w.\-]/g, '_');
    const key = `${user.id}/${Date.now()}-${name}`;
    await env.FILES.put(key, req.body, { httpMetadata: { contentType: req.headers.get('content-type') || 'application/octet-stream' } });
    return json({ key });
  }
  if ((x = p.match(/^\/file\/(.+)$/)) && m === 'GET') {
    if (!env.FILES) return err(501, 'Fayl saqlash yoqilmagan');
    const key = decodeURIComponent(x[1]);
    if (!key.startsWith(user.id + '/') && !isMod(user)) return err(403, 'Ruxsat yo‘q');
    const o = await env.FILES.get(key);
    if (!o) return err(404, 'Topilmadi');
    return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'application/octet-stream' } });
  }
  return err(404, 'Topilmadi');
}

// ---------- Ro'yxatdan o'tish / profil ----------
async function register(env, tg, user, b) {
  if (user) return err(409, 'Siz allaqachon ro‘yxatdan o‘tgansiz');
  const fullName = clip(b.full_name, 80), nick = clip(b.nickname, 20).replace(/^@/, '');
  const group = +b.group_no;
  if (fullName.length < 3) return err(400, 'Ism familiyani to‘liq kiriting');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(nick)) return err(400, 'Nickname: 3–20 ta lotin harf, raqam yoki _');
  if (!GROUPS[group]) return err(400, 'Guruhni tanlang (101–107)');
  if (!LEVELS.includes(b.level)) return err(400, 'Darajani tanlang (A1–C2)');
  const exps = (Array.isArray(b.experiences) ? b.experiences : []).filter((e) => EXPERIENCES.includes(e));
  try {
    await env.DB.prepare('INSERT INTO users (id,username,full_name,nickname,group_no,direction,level,experiences,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(tg.id, tg.username || null, fullName, nick, group, GROUPS[group], b.level, JSON.stringify(exps), Date.now()).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return err(409, 'Bu nickname band');
    throw e;
  }
  await addXp(env, tg.id, XP.REGISTER, 'Profil yaratildi va ro‘yxatdan o‘tildi');
  await awardBadge(env, tg.id, 'member');
  return json({ user: await publicUser(env, await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(tg.id).first()) });
}
async function publicUser(env, u) {
  const badges = (await env.DB.prepare('SELECT badge_id FROM badges WHERE user_id=?').bind(u.id).all()).results.map((r) => r.badge_id);
  const history = (await env.DB.prepare('SELECT delta,reason,created_at FROM xp_log WHERE user_id=? ORDER BY id DESC LIMIT 10').bind(u.id).all()).results;
  const unread = (await env.DB.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').bind(u.id).first()).c;
  return { ...u, experiences: JSON.parse(u.experiences || '[]'), badges, history, unread, is_mod: isMod(u), is_super: isSuper(u), days_in_club: Math.floor((Date.now() - u.created_at) / DAY) + 1 };
}
async function claimRole(env, user, b) {
  const key = clip(b.key, 100);
  if (!key) return err(400, 'Kalit so‘z kiritilmadi');
  const recent = await env.DB.prepare('SELECT COUNT(*) c FROM key_attempts WHERE user_id=? AND ts>?').bind(user.id, Date.now() - 600000).first();
  if (recent.c >= 5) return err(429, 'Juda ko‘p urinish. 10 daqiqadan so‘ng qayta urining');
  const s = await getKeys(env);
  if (await sha256hex('m:' + key) === s.master_hash) {
    await env.DB.prepare(`UPDATE users SET role='super_admin', mod_until=NULL WHERE id=?`).bind(user.id).run();
    await audit(env, user.id, 'Bosh tashkilotchi sifatida kirdi');
    return json({ role: 'super_admin' });
  }
  if (await sha256hex('t:' + key) === s.temp_hash) {
    if (user.role === 'super_admin') return json({ role: 'super_admin' });
    const until = Date.now() + (+s.temp_minutes || 60) * 60000;
    await env.DB.prepare(`UPDATE users SET role='moderator', mod_until=? WHERE id=?`).bind(until, user.id).run();
    await audit(env, user.id, `Vaqtinchalik moderator oldi (${s.temp_minutes} daqiqa)`);
    return json({ role: 'moderator', until });
  }
  await env.DB.prepare('INSERT INTO key_attempts (user_id,ts) VALUES (?,?)').bind(user.id, Date.now()).run();
  return err(403, 'Noto‘g‘ri maxsus kalit so‘z');
}

// ---------- Darslar ----------
async function listSchedules(env, user) {
  const rows = (await env.DB.prepare('SELECT s.*, u.full_name AS speaker_name FROM schedules s LEFT JOIN users u ON u.id=s.speaker_id ORDER BY s.starts_at DESC LIMIT 200').all()).results;
  const rs = (await env.DB.prepare('SELECT r.schedule_id, r.user_id, r.attended, u.full_name, u.nickname FROM rsvps r JOIN users u ON u.id=r.user_id').all()).results;
  const mine = (await env.DB.prepare('SELECT schedule_id, score, total FROM test_results WHERE user_id=?').bind(user.id).all()).results;
  const mod = isMod(user), now = Date.now();
  return json({
    schedules: rows.map((s) => {
      const qs = JSON.parse(s.questions || '[]');
      return {
        ...s, vocab: JSON.parse(s.vocab || '[]'), links: JSON.parse(s.links || '[]'),
        // to'g'ri javoblar faqat moderatorga; foydalanuvchiga test topshirgandan keyin beriladi
        questions: mod ? qs : qs.map(({ correctIndex, explanation, advice, ...q }) => q),
        rsvps: rs.filter((r) => r.schedule_id === s.id),
        my_result: mine.find((r) => r.schedule_id === s.id) || null,
        past: s.starts_at < now - 7 * DAY, // 1 haftadan keyin "o'tilgan darslar"ga tushadi
      };
    }),
  });
}
async function createSchedule(env, user, b) {
  if (!b.topic || !(+b.starts_at > 0)) return err(400, 'Mavzu va vaqt kerak');
  const r = await env.DB.prepare('INSERT INTO schedules (lesson_number,topic,level,location,starts_at,duration_min,explanation,vocab,links,questions,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(b.lesson_number || null, clip(b.topic, 300), clip(b.level, 40), clip(b.location, 120), +b.starts_at, +b.duration_min || 80,
      String(b.explanation || ''), JSON.stringify(b.vocab || []), JSON.stringify(b.links || []), JSON.stringify(b.questions || []), user.id, Date.now()).run();
  return json({ id: r.meta.last_row_id });
}
async function updateSchedule(env, user, id, b) { // speaker_id bu yerda o'zgarmaydi
  const fields = ['lesson_number', 'topic', 'level', 'location', 'starts_at', 'duration_min', 'explanation', 'vocab', 'links', 'questions'];
  const sets = [], vals = [];
  for (const k of fields) {
    if (!(k in b)) continue;
    sets.push(`${k}=?`);
    vals.push(['vocab', 'links', 'questions'].includes(k) ? JSON.stringify(b[k]) : b[k]);
  }
  if (!sets.length) return err(400, 'O‘zgartirish yo‘q');
  await env.DB.prepare(`UPDATE schedules SET ${sets.join(',')} WHERE id=?`).bind(...vals, id).run();
  if ('location' in b || 'starts_at' in b) { // joy/vaqt o'zgarsa yozilganlarga xabar
    const us = (await env.DB.prepare('SELECT user_id FROM rsvps WHERE schedule_id=?').bind(id).all()).results;
    const s = await env.DB.prepare('SELECT topic,location,starts_at FROM schedules WHERE id=?').bind(id).first();
    for (const u of us) await notify(env, u.user_id, `ℹ️ Dars yangilandi: ${s.topic.slice(0, 60)} — ${tashkent(s.starts_at)}, ${s.location || 'xona keyin e’lon qilinadi'}`);
  }
  return json({ ok: true });
}
async function rsvp(env, user, id, b) {
  const s = await env.DB.prepare('SELECT * FROM schedules WHERE id=?').bind(id).first();
  if (!s) return err(404, 'Dars topilmadi');
  if (s.starts_at < Date.now()) return err(409, 'Dars boshlangan');
  if (b.speaker) {
    const r = await env.DB.prepare('UPDATE schedules SET speaker_id=? WHERE id=? AND speaker_id IS NULL').bind(user.id, id).run();
    if (!r.meta.changes) return err(409, 'Bu darsda speaker allaqachon tanlangan');
  }
  await env.DB.prepare('INSERT OR IGNORE INTO rsvps (schedule_id,user_id,created_at) VALUES (?,?,?)').bind(id, user.id, Date.now()).run();
  return json({ ok: true });
}
async function unrsvp(env, user, id) {
  const s = await env.DB.prepare('SELECT speaker_id FROM schedules WHERE id=?').bind(id).first();
  if (!s) return err(404, 'Dars topilmadi');
  if (s.speaker_id === user.id) return err(409, 'Avval speakerlikdan voz keching');
  await env.DB.prepare('DELETE FROM rsvps WHERE schedule_id=? AND user_id=?').bind(id, user.id).run();
  return json({ ok: true });
}
async function cancelSpeaker(env, user, id) {
  const s = await env.DB.prepare('SELECT * FROM schedules WHERE id=?').bind(id).first();
  if (!s || s.speaker_id !== user.id) return err(404, 'Siz bu darsda speaker emassiz');
  if (s.starts_at - Date.now() < DAY) return err(409, 'Darsga 24 soatdan kam qoldi — speakerlikdan voz kechib bo‘lmaydi');
  await env.DB.prepare('UPDATE schedules SET speaker_id=NULL, speaker_confirmed=0 WHERE id=?').bind(id).run();
  await addXp(env, user.id, XP.SPEAKER_CANCEL, 'Speakerlikdan voz kechildi');
  await notifyMods(env, `⚠️ @${user.nickname} ${s.lesson_number || ''}-dars speakerligidan voz kechdi`);
  return json({ ok: true, xp: XP.SPEAKER_CANCEL });
}
async function speakerDone(env, id) {
  const s = await env.DB.prepare('SELECT * FROM schedules WHERE id=?').bind(id).first();
  if (!s?.speaker_id) return err(404, 'Speaker yo‘q');
  if (s.speaker_confirmed) return err(409, 'Allaqachon tasdiqlangan');
  await env.DB.prepare('UPDATE schedules SET speaker_confirmed=1 WHERE id=?').bind(id).run();
  await addXp(env, s.speaker_id, XP.SPEAKER_DONE, 'Speakerlik bajarildi');
  await awardBadge(env, s.speaker_id, 'first_speaking');
  return json({ ok: true });
}
async function markAttendance(env, id, b) {
  if (!['present', 'absent', 'excused'].includes(b.status)) return err(400, 'Holat noto‘g‘ri');
  const r = await env.DB.prepare('SELECT attended FROM rsvps WHERE schedule_id=? AND user_id=?').bind(id, +b.user_id).first();
  if (!r) return err(404, 'Foydalanuvchi bu darsga yozilmagan');
  await env.DB.prepare('UPDATE rsvps SET attended=? WHERE schedule_id=? AND user_id=?').bind(b.status, id, +b.user_id).run();
  if (b.status === 'absent' && r.attended !== 'absent') await addXp(env, +b.user_id, XP.ABSENT, 'Darsda sababsiz qatnashmadi');
  if (r.attended === 'absent' && b.status !== 'absent') await addXp(env, +b.user_id, -XP.ABSENT, 'Davomat tuzatildi');
  if (b.status === 'present') { // ketma-ket 5 / jami 10 dars nishonlari
    const rows = (await env.DB.prepare('SELECT r.attended FROM rsvps r JOIN schedules s ON s.id=r.schedule_id WHERE r.user_id=? AND r.attended IS NOT NULL ORDER BY s.starts_at DESC').bind(+b.user_id).all()).results;
    let streak = 0; for (const x of rows) { if (x.attended === 'present') streak++; else break; }
    const total = rows.filter((x) => x.attended === 'present').length;
    if (streak >= 5) await awardBadge(env, +b.user_id, 'real_student');
    if (total >= 10) await awardBadge(env, +b.user_id, 'goal_getter');
  }
  return json({ ok: true });
}
async function gradeTest(env, user, id, b) {
  const s = await env.DB.prepare('SELECT questions FROM schedules WHERE id=?').bind(id).first();
  const qs = JSON.parse(s?.questions || '[]');
  if (!qs.length) return err(404, 'Bu darsda test yo‘q');
  let score = 0;
  const review = qs.map((q) => { const picked = b.answers?.[q.id]; const ok = picked === q.correctIndex; if (ok) score++; return { id: q.id, picked, ok, correctIndex: q.correctIndex, explanation: q.explanation, advice: q.advice }; });
  const total = qs.length, green = score / total > 26 / 30; // 30 tadan 26 dan ko'p = yashil
  const prev = await env.DB.prepare('SELECT score,total FROM test_results WHERE schedule_id=? AND user_id=?').bind(id, user.id).first();
  const prevGreen = prev ? prev.score / prev.total > 26 / 30 : false;
  await env.DB.prepare('INSERT INTO test_results (schedule_id,user_id,score,total,created_at) VALUES (?,?,?,?,?) ON CONFLICT(schedule_id,user_id) DO UPDATE SET score=MAX(score,excluded.score), total=excluded.total')
    .bind(id, user.id, score, total, Date.now()).run();
  let bonus = 0;
  if (green && !prevGreen) { // har 3 ta yashil natijadan +50 XP (avtomatik)
    const g = (user.green_tests || 0) + 1;
    await env.DB.prepare('UPDATE users SET green_tests=? WHERE id=?').bind(g, user.id).run();
    if (g % 3 === 0) { bonus = XP.TEST_GREEN; await addXp(env, user.id, bonus, 'Har 3 ta yashil test natijasi'); }
  }
  return json({ score, total, green, bonus_xp: bonus, review });
}

// ---------- Eslatmalar (cron, har 5 daqiqada) ----------
async function sendReminders(env) {
  const now = Date.now();
  for (let i = 0; i < REMINDER_WINDOWS.length; i++) {
    const hi = REMINDER_WINDOWS[i], lo = REMINDER_WINDOWS[i + 1] || 0; // (lo, hi] daqiqa ichida
    const rows = (await env.DB.prepare(`
      SELECT s.id, s.topic, s.starts_at, s.location, r.user_id FROM schedules s
      JOIN rsvps r ON r.schedule_id=s.id JOIN users u ON u.id=r.user_id
      WHERE u.notify=1 AND s.starts_at > ? AND s.starts_at <= ?
        AND NOT EXISTS (SELECT 1 FROM reminders_sent x WHERE x.schedule_id=s.id AND x.user_id=r.user_id AND x.window_min=?)`)
      .bind(now + lo * 60000, now + hi * 60000, hi).all()).results;
    for (const r of rows) {
      const mins = Math.round((r.starts_at - now) / 60000);
      const left = mins >= 90 ? `${Math.round(mins / 60)} soat` : `${mins} daqiqa`;
      await env.DB.prepare('INSERT OR IGNORE INTO reminders_sent (schedule_id,user_id,window_min) VALUES (?,?,?)').bind(r.id, r.user_id, hi).run();
      await notify(env, r.user_id, `⏰ Dars boshlanishiga ~${left} qoldi: ${r.topic.slice(0, 80)} (${tashkent(r.starts_at)}, ${r.location || 'xona tez orada e’lon qilinadi'})`);
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM key_attempts WHERE ts<?').bind(now - DAY),
  ]);
}
