// English Peers — Cloudflare Worker + D1 (peers.txt asosida kengaytirilgan)
const enc = new TextEncoder();
const MAX_BODY = 1_500_000;

const BADGE_DEFS = {
  first_speaker: { xp: 200, title: 'Dastlabki speakerlik' },
  true_learner:  { xp: 70,  title: 'Haqiqiy o‘quvchi (5 ketma-ket dars)' },
  goal_seeker:   { xp: 140, title: 'Maqsad sari boruvchi (10 dars)' },
  listener:      { xp: 500, title: 'Tinglovchi nishoni' },
  writer:        { xp: 300, title: 'Mohir yozuvchi' },
  speaker:       { xp: 800, title: 'So‘zlovchi nishoni' },
  helper:        { xp: 100, title: 'Ko‘makchi nishoni' },
  test_master:   { xp: 50,  title: 'Test ustasi (26+/30)' },
};

const GROUPS = {
  '101': 'Axborot tizimlari va texnologiyalari',
  '102': 'Sun’iy intellekt',
  '103': 'Matematika',
  '104': 'Matematika',
  '105': 'Matematika',
  '106': 'Oliy matematika',
  '107': 'Oliy matematika',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

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

function parse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
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

async function getUser(db, tgId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(tgId).first();
}

async function isModerator(db, tgId) {
  const u = await getUser(db, tgId);
  if (!u) return false;
  if (u.role === 'super_admin') return true;
  if (u.role === 'temp_moderator' && u.mod_expires && Number(u.mod_expires) > Date.now()) return true;
  return false;
}

/** XP qo‘shish / ayirish + log */
async function addXp(db, tgId, amount, reason, meta = null) {
  if (!amount) return null;
  await db.batch([
    db.prepare('UPDATE users SET total_xp = total_xp + ?, updated_at = datetime(\'now\') WHERE telegram_id = ?').bind(amount, tgId),
    db.prepare('INSERT INTO xp_log(telegram_id, amount, reason, meta_json) VALUES(?, ?, ?, ?)').bind(
      tgId, amount, reason, meta ? JSON.stringify(meta) : null
    ),
  ]);
  const row = await db.prepare('SELECT total_xp FROM users WHERE telegram_id = ?').bind(tgId).first();
  return row?.total_xp ?? null;
}

/** Nishon berish (bir marta) */
async function awardBadge(db, tgId, badgeCode, awardedBy = 'system', note = null) {
  const def = BADGE_DEFS[badgeCode];
  if (!def) return { ok: false, error: 'Noma’lum nishon' };
  const existing = await db
    .prepare('SELECT id, status FROM user_badges WHERE telegram_id = ? AND badge_code = ?')
    .bind(tgId, badgeCode)
    .first();
  if (existing && existing.status === 'awarded') return { ok: false, error: 'Allaqachon olingan' };

  if (existing) {
    await db
      .prepare('UPDATE user_badges SET status = ?, xp_awarded = ?, awarded_by = ?, note = ? WHERE id = ?')
      .bind('awarded', def.xp, awardedBy, note, existing.id)
      .run();
  } else {
    await db
      .prepare(
        'INSERT INTO user_badges(telegram_id, badge_code, xp_awarded, status, awarded_by, note) VALUES(?, ?, ?, ?, ?, ?)'
      )
      .bind(tgId, badgeCode, def.xp, 'awarded', awardedBy, note)
      .run();
  }
  await addXp(db, tgId, def.xp, `Nishon: ${def.title}`, { badge: badgeCode });
  return { ok: true, badge: badgeCode, xp: def.xp, title: def.title };
}

/** Ketma-ket / jami dars hisobi va avtomatik nishonlar */
async function checkAttendanceBadges(db, tgId) {
  // Jami present/late soni
  const total = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM attendance WHERE telegram_id = ? AND status IN ('present','late')`
    )
    .bind(tgId)
    .first();
  const totalCount = total?.c || 0;

  // Ketma-ket (oxirgi darslar bo‘yicha)
  const recent = await db
    .prepare(
      `SELECT a.status, l.lesson_date FROM attendance a
       JOIN lessons l ON l.id = a.lesson_id
       WHERE a.telegram_id = ?
       ORDER BY l.lesson_date DESC LIMIT 15`
    )
    .bind(tgId)
    .all();

  let streak = 0;
  for (const row of recent.results || []) {
    if (row.status === 'present' || row.status === 'late') streak++;
    else break;
  }

  await db
    .prepare('UPDATE users SET streak_days = ?, updated_at = datetime(\'now\') WHERE telegram_id = ?')
    .bind(streak, tgId)
    .run();

  const awarded = [];
  if (streak >= 5) {
    const r = await awardBadge(db, tgId, 'true_learner');
    if (r.ok) awarded.push(r);
  }
  if (totalCount >= 10) {
    const r = await awardBadge(db, tgId, 'goal_seeker');
    if (r.ok) awarded.push(r);
  }
  return { streak, totalCount, awarded };
}

/** Speaker bekor qilish: 24 soatdan kam qolgan bo‘lsa taqiqlanadi */
function canCancelSpeaker(lessonDate, lessonTime = '13:20') {
  try {
    const [y, m, d] = lessonDate.split('-').map(Number);
    const [hh, mm] = (lessonTime || '13:20').split(':').map(Number);
    const start = Date.UTC(y, m - 1, d, hh || 13, mm || 20);
    const hoursLeft = (start - Date.now()) / 3600000;
    return hoursLeft >= 24;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const db = env.DB;

    // Static assets
    if (!path.startsWith('/api/') && path !== '/health') {
      return env.ASSETS.fetch(request);
    }

    try {
      if (path === '/health') return json({ ok: true, version: '2.0' });

      // ---------- AUTH ----------
      if (path === '/api/auth/telegram' && method === 'POST') {
        const body = await readBody(request);
        let user;
        try {
          user = await validateTelegramInitData(body.initData, env.BOT_TOKEN);
        } catch (e) {
          return json({ error: e.message }, 401);
        }
        const id = String(user.id);
        await db
          .prepare(
            `INSERT INTO users(telegram_id, username) VALUES(?1, ?2)
             ON CONFLICT(telegram_id) DO UPDATE SET username = ?2, updated_at = datetime('now')`
          )
          .bind(id, user.username || '')
          .run();
        const row = await getUser(db, id);
        return json({
          token: await signToken(id, env),
          user,
          profile: parse(row.profile_json),
          state: parse(row.state_json),
          role: row.role,
          modExpires: row.mod_expires,
          totalXp: row.total_xp,
        });
      }

      const tgId = await readToken(request, env);
      if (!tgId) return json({ error: 'Avtorizatsiya talab qilinadi' }, 401);

      // ---------- STATE ----------
      if (path === '/api/state' && method === 'GET') {
        const row = await getUser(db, tgId);
        if (!row) return json({ error: 'Foydalanuvchi topilmadi' }, 404);
        const badges = await db
          .prepare('SELECT badge_code, xp_awarded, status, note, created_at FROM user_badges WHERE telegram_id = ?')
          .bind(tgId)
          .all();
        const state = parse(row.state_json) || {};
        return json({
          ...state,
          profile: parse(row.profile_json) || state.profile || null,
          role: row.role,
          modExpires: row.mod_expires,
          totalXp: row.total_xp,
          streakDays: row.streak_days,
          badges: badges.results || [],
        });
      }

      if (path === '/api/state' && method === 'PUT') {
        const body = await readBody(request);
        const profile = body.profile || null;
        const state = { ...body };
        delete state.profile;
        await db
          .prepare(
            `UPDATE users SET profile_json = ?, state_json = ?, updated_at = datetime('now') WHERE telegram_id = ?`
          )
          .bind(profile ? JSON.stringify(profile) : null, JSON.stringify(state), tgId)
          .run();
        return json({ ok: true });
      }

      // ---------- PROFILE / REGISTRATSIYA ----------
      if (path === '/api/profile' && method === 'PUT') {
        const p = await readBody(request);
        if (!p.fullName || !p.group || !p.level) {
          return json({ error: 'Profil ma’lumotlari to‘liq emas (ism, guruh, daraja)' }, 400);
        }
        if (!GROUPS[String(p.group)] && !Object.values(GROUPS).includes(p.group)) {
          // guruh kodi yoki nomi qabul qilinadi
        }
        const row = await getUser(db, tgId);
        const isNew = !row?.profile_json && !row?.full_name;

        const profile = {
          fullName: p.fullName,
          group: p.group,
          level: p.level,
          interests: p.interests || [],
          experience: p.experience || p.experiences || null,
          baseRole: 'learner',
          activeRole: row?.role || 'learner',
          xp: (row?.total_xp || 0) + (isNew ? 50 : 0),
          streak: row?.streak_days || 0,
          createdAt: row?.created_at || new Date().toISOString(),
          joinedAt: row?.created_at || new Date().toISOString(),
          attendanceDays: p.attendanceDays || [],
          badges: p.badges || [],
          history: p.history || [],
        };

        await db
          .prepare(
            `UPDATE users SET
              full_name = ?, group_code = ?, level = ?, experience_json = ?,
              profile_json = ?, updated_at = datetime('now')
             WHERE telegram_id = ?`
          )
          .bind(
            p.fullName,
            String(p.group),
            p.level,
            p.experience || p.experiences ? JSON.stringify(p.experience || p.experiences) : null,
            JSON.stringify(profile),
            tgId
          )
          .run();

        if (isNew) {
          await addXp(db, tgId, 50, 'Profil yaratildi / ro‘yxatdan o‘tish');
          profile.xp = (row?.total_xp || 0) + 50;
          profile.history = [
            { text: 'English Peers klubiga qo‘shildi (+50 XP)', time: 'Hozirgina' },
            ...(profile.history || []),
          ];
          await db
            .prepare('UPDATE users SET profile_json = ? WHERE telegram_id = ?')
            .bind(JSON.stringify(profile), tgId)
            .run();
        }

        const updated = await getUser(db, tgId);
        return json({ ok: true, profile, totalXp: updated.total_xp, isNew });
      }

      // ---------- MODERATOR KALIT ----------
      if (path === '/api/moderator/activate' && method === 'POST') {
        const body = await readBody(request);
        const key = String(body.key || '');
        const master = env.MASTER_KEY || '';
        const mod = env.MODERATOR_KEY || '';
        const role =
          master && safeEqual(key, master)
            ? 'super_admin'
            : mod && safeEqual(key, mod)
              ? 'temp_moderator'
              : null;
        if (!role) return json({ valid: false, error: 'Kalit noto‘g‘ri' }, 403);
        const minutes = Number(env.MODERATOR_MINUTES || 60);
        const expires = role === 'temp_moderator' ? Date.now() + minutes * 60000 : null;
        await db.batch([
          db.prepare('UPDATE users SET role = ?, mod_expires = ?, updated_at = datetime(\'now\') WHERE telegram_id = ?').bind(
            role,
            expires,
            tgId
          ),
          db.prepare('INSERT INTO audit(telegram_id, action) VALUES(?, ?)').bind(tgId, `Moderator role: ${role}`),
        ]);
        return json({ valid: true, role, expiresAt: expires });
      }

      // ---------- XP ----------
      if (path === '/api/xp' && method === 'POST') {
        const body = await readBody(request);
        const amount = Number(body.amount || 0);
        const reason = String(body.reason || 'XP').slice(0, 200);
        if (!amount || Math.abs(amount) > 2000) return json({ error: 'Noto‘g‘ri XP miqdori' }, 400);
        // Oddiy foydalanuvchi faqat musbat kichik XP (client-side events); katta/ayirish — moderator
        if (amount < 0 || amount > 100) {
          if (!(await isModerator(db, tgId))) return json({ error: 'Ruxsat yo‘q' }, 403);
        }
        const total = await addXp(db, tgId, amount, reason, body.meta || null);
        return json({ ok: true, totalXp: total });
      }

      if (path === '/api/xp/history' && method === 'GET') {
        const rows = await db
          .prepare('SELECT amount, reason, created_at FROM xp_log WHERE telegram_id = ? ORDER BY id DESC LIMIT 50')
          .bind(tgId)
          .all();
        return json({ items: rows.results || [] });
      }

      // ---------- BADGES ----------
      if (path === '/api/badges' && method === 'GET') {
        const rows = await db
          .prepare('SELECT * FROM user_badges WHERE telegram_id = ? ORDER BY created_at DESC')
          .bind(tgId)
          .all();
        return json({ items: rows.results || [], defs: BADGE_DEFS });
      }

      if (path === '/api/badges/award' && method === 'POST') {
        if (!(await isModerator(db, tgId))) return json({ error: 'Faqat moderator' }, 403);
        const body = await readBody(request);
        const targetId = String(body.telegramId || body.telegram_id || '');
        const code = String(body.badgeCode || body.badge_code || '');
        if (!targetId || !code) return json({ error: 'telegramId va badgeCode kerak' }, 400);
        const result = await awardBadge(db, targetId, code, tgId, body.note || null);
        return json(result, result.ok ? 200 : 400);
      }

      // ---------- LESSONS ----------
      if (path === '/api/lessons' && method === 'GET') {
        const status = url.searchParams.get('status') || 'active';
        const rows = await db
          .prepare(
            `SELECT * FROM lessons WHERE status = ? ORDER BY lesson_date ASC, lesson_time ASC LIMIT 100`
          )
          .bind(status)
          .all();
        return json({ items: rows.results || [] });
      }

      if (path === '/api/lessons' && method === 'POST') {
        if (!(await isModerator(db, tgId))) return json({ error: 'Faqat moderator' }, 403);
        const b = await readBody(request);
        if (!b.topic || !b.lesson_date) return json({ error: 'topic va lesson_date kerak' }, 400);
        const id = b.id || `lesson-${Date.now()}`;
        await db
          .prepare(
            `INSERT INTO lessons(
              id, week_start, lesson_number, day_name, lesson_date, lesson_time, room, level,
              topic, speaker_id, speaker_name, explanation, vocab_json, questions_json, links_json,
              status, created_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .bind(
            id,
            b.week_start || null,
            b.lesson_number || null,
            b.day_name || null,
            b.lesson_date,
            b.lesson_time || '13:20',
            b.room || null,
            b.level || null,
            b.topic,
            b.speaker_id || null,
            b.speaker_name || null,
            b.explanation || null,
            b.vocab ? JSON.stringify(b.vocab) : null,
            b.questions ? JSON.stringify(b.questions) : null,
            b.links ? JSON.stringify(b.links) : null,
            b.status || 'active',
            tgId
          )
          .run();
        return json({ ok: true, id });
      }

      // Darsni tahrirlash (speaker o‘zgartirilmaydi — peers.txt)
      if (path.startsWith('/api/lessons/') && method === 'PUT') {
        if (!(await isModerator(db, tgId))) return json({ error: 'Faqat moderator' }, 403);
        const lessonId = path.split('/')[3];
        const b = await readBody(request);
        const existing = await db.prepare('SELECT * FROM lessons WHERE id = ?').bind(lessonId).first();
        if (!existing) return json({ error: 'Dars topilmadi' }, 404);
        await db
          .prepare(
            `UPDATE lessons SET
              week_start = COALESCE(?, week_start),
              lesson_number = COALESCE(?, lesson_number),
              day_name = COALESCE(?, day_name),
              lesson_date = COALESCE(?, lesson_date),
              lesson_time = COALESCE(?, lesson_time),
              room = COALESCE(?, room),
              level = COALESCE(?, level),
              topic = COALESCE(?, topic),
              explanation = COALESCE(?, explanation),
              vocab_json = COALESCE(?, vocab_json),
              questions_json = COALESCE(?, questions_json),
              links_json = COALESCE(?, links_json),
              status = COALESCE(?, status),
              updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(
            b.week_start ?? null,
            b.lesson_number ?? null,
            b.day_name ?? null,
            b.lesson_date ?? null,
            b.lesson_time ?? null,
            b.room ?? null,
            b.level ?? null,
            b.topic ?? null,
            b.explanation ?? null,
            b.vocab ? JSON.stringify(b.vocab) : null,
            b.questions ? JSON.stringify(b.questions) : null,
            b.links ? JSON.stringify(b.links) : null,
            b.status ?? null,
            lessonId
          )
          .run();
        // speaker_id / speaker_name o‘zgartirilmaydi
        return json({ ok: true });
      }

      // ---------- SPEAKER CLAIM / CANCEL ----------
      if (path.match(/^\/api\/lessons\/[^/]+\/speaker$/) && method === 'POST') {
        const lessonId = path.split('/')[3];
        const body = await readBody(request);
        const action = body.action || 'claim'; // claim | cancel | confirm
        const lesson = await db.prepare('SELECT * FROM lessons WHERE id = ?').bind(lessonId).first();
        if (!lesson) return json({ error: 'Dars topilmadi' }, 404);
        const user = await getUser(db, tgId);

        if (action === 'claim') {
          if (lesson.speaker_id) return json({ error: 'Speaker allaqachon band' }, 409);
          await db
            .prepare(
              `UPDATE lessons SET speaker_id = ?, speaker_name = ?, speaker_claimed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
            )
            .bind(tgId, user?.full_name || user?.username || 'Speaker', lessonId)
            .run();
          return json({ ok: true, action: 'claimed' });
        }

        if (action === 'cancel') {
          if (lesson.speaker_id !== tgId && !(await isModerator(db, tgId))) {
            return json({ error: 'Faqat o‘zingiz yoki moderator bekor qila oladi' }, 403);
          }
          if (lesson.speaker_id === tgId && !canCancelSpeaker(lesson.lesson_date, lesson.lesson_time)) {
            return json({
              error: 'Dars boshlanishiga 24 soatdan kam qolgan — speakerlikni bekor qilib bo‘lmaydi',
              code: 'TOO_LATE',
            }, 400);
          }
          // Agar o‘zi kech bekor qilsa (moderator emas) — -90 XP
          if (lesson.speaker_id === tgId && !canCancelSpeaker(lesson.lesson_date, lesson.lesson_time)) {
            await addXp(db, tgId, -90, 'Speakerlikdan kech voz kechish', { lessonId });
          }
          // 24h+ bekor — jarimasiz
          await db
            .prepare(
              `UPDATE lessons SET speaker_id = NULL, speaker_name = NULL, speaker_confirmed = 0, speaker_claimed_at = NULL, updated_at = datetime('now') WHERE id = ?`
            )
            .bind(lessonId)
            .run();
          return json({ ok: true, action: 'cancelled' });
        }

        if (action === 'confirm') {
          if (!(await isModerator(db, tgId))) return json({ error: 'Faqat moderator' }, 403);
          if (!lesson.speaker_id) return json({ error: 'Speaker yo‘q' }, 400);
          await db
            .prepare('UPDATE lessons SET speaker_confirmed = 1, updated_at = datetime(\'now\') WHERE id = ?')
            .bind(lessonId)
            .run();
          // +300 XP speakerlik uchun (peers.txt)
          await addXp(db, lesson.speaker_id, 300, 'Speakerlik tasdiqlandi', { lessonId });
          const first = await awardBadge(db, lesson.speaker_id, 'first_speaker', tgId);
          return json({ ok: true, action: 'confirmed', firstSpeakerBadge: first });
        }

        return json({ error: 'Noma’lum action' }, 400);
      }

      // ---------- RSVP ----------
      if (path.match(/^\/api\/lessons\/[^/]+\/rsvp$/) && method === 'POST') {
        const lessonId = path.split('/')[3];
        const body = await readBody(request);
        const user = await getUser(db, tgId);
        const name = user?.full_name || user?.username || 'O‘quvchi';
        if (body.cancel) {
          await db
            .prepare('DELETE FROM lesson_rsvps WHERE lesson_id = ? AND telegram_id = ?')
            .bind(lessonId, tgId)
            .run();
          return json({ ok: true, rsvp: false });
        }
        await db
          .prepare(
            `INSERT INTO lesson_rsvps(lesson_id, telegram_id, full_name, notify)
             VALUES(?, ?, ?, ?)
             ON CONFLICT(lesson_id, telegram_id) DO UPDATE SET notify = excluded.notify`
          )
          .bind(lessonId, tgId, name, body.notify === false ? 0 : 1)
          .run();
        await addXp(db, tgId, 10, 'Darsga yozildi', { lessonId });
        return json({ ok: true, rsvp: true });
      }

      // ---------- DAVOMAT ----------
      if (path.match(/^\/api\/lessons\/[^/]+\/attendance$/) && method === 'POST') {
        if (!(await isModerator(db, tgId))) {
          // Speaker ham belgilashi mumkin
          const lessonId = path.split('/')[3];
          const lesson = await db.prepare('SELECT speaker_id FROM lessons WHERE id = ?').bind(lessonId).first();
          if (!lesson || lesson.speaker_id !== tgId) {
            return json({ error: 'Faqat moderator yoki speaker' }, 403);
          }
        }
        const lessonId = path.split('/')[3];
        const body = await readBody(request);
        // body.records = [{ telegram_id, full_name, status }]
        const records = Array.isArray(body.records) ? body.records : [];
        for (const r of records) {
          const status = r.status || 'absent';
          let xpDelta = 0;
          if (status === 'absent') xpDelta = -80; // sababsiz
          else if (status === 'present' || status === 'late') xpDelta = 0;

          const existing = await db
            .prepare('SELECT id, status, xp_delta FROM attendance WHERE lesson_id = ? AND telegram_id = ?')
            .bind(lessonId, r.telegram_id)
            .first();

          if (existing) {
            // Eski jarimani qaytarish
            if (existing.xp_delta) await addXp(db, r.telegram_id, -existing.xp_delta, 'Davomat tuzatildi', { lessonId });
            await db
              .prepare(
                `UPDATE attendance SET status = ?, marked_by = ?, xp_delta = ?, full_name = COALESCE(?, full_name)
                 WHERE id = ?`
              )
              .bind(status, tgId, xpDelta, r.full_name || null, existing.id)
              .run();
          } else {
            await db
              .prepare(
                `INSERT INTO attendance(lesson_id, telegram_id, full_name, status, marked_by, xp_delta)
                 VALUES(?, ?, ?, ?, ?, ?)`
              )
              .bind(lessonId, r.telegram_id, r.full_name || null, status, tgId, xpDelta)
              .run();
          }
          if (xpDelta) await addXp(db, r.telegram_id, xpDelta, `Davomat: ${status}`, { lessonId });
          if (status === 'present' || status === 'late') {
            await checkAttendanceBadges(db, r.telegram_id);
          }
        }
        return json({ ok: true, count: records.length });
      }

      if (path.match(/^\/api\/lessons\/[^/]+\/attendance$/) && method === 'GET') {
        const lessonId = path.split('/')[3];
        // Yozilganlar + davomat
        const rsvps = await db
          .prepare('SELECT telegram_id, full_name, notify FROM lesson_rsvps WHERE lesson_id = ?')
          .bind(lessonId)
          .all();
        const att = await db
          .prepare('SELECT * FROM attendance WHERE lesson_id = ?')
          .bind(lessonId)
          .all();
        return json({ rsvps: rsvps.results || [], attendance: att.results || [] });
      }

      // ---------- TEST NATIJASI ----------
      if (path === '/api/tests/submit' && method === 'POST') {
        const b = await readBody(request);
        if (!b.lesson_id || b.correct == null || !b.total_q) {
          return json({ error: 'lesson_id, correct, total_q kerak' }, 400);
        }
        const percent = Math.round((Number(b.correct) / Number(b.total_q)) * 100);
        await db
          .prepare(
            `INSERT INTO test_attempts(lesson_id, telegram_id, total_q, correct, percent, answers_json)
             VALUES(?, ?, ?, ?, ?, ?)`
          )
          .bind(b.lesson_id, tgId, b.total_q, b.correct, percent, b.answers ? JSON.stringify(b.answers) : null)
          .run();

        // 26+ / 30 → test_master +50 XP (peers.txt: har 3-ta yashil natijadan keyin ham bo‘lishi mumkin;
        // oddiy qoida: 26+ to‘g‘ri)
        let badge = null;
        if (Number(b.total_q) >= 30 && Number(b.correct) >= 26) {
          badge = await awardBadge(db, tgId, 'test_master');
        }
        const xpGain = Math.max(10, Math.round(percent / 4));
        const total = await addXp(db, tgId, xpGain, `Test: ${percent}%`, { lesson_id: b.lesson_id });
        return json({ ok: true, percent, totalXp: total, badge });
      }

      // ---------- VOCAB (+3 XP, kuniga max 10) ----------
      if (path === '/api/vocab' && method === 'POST') {
        const b = await readBody(request);
        if (!b.word || !b.translation) return json({ error: 'word va translation kerak' }, 400);
        const today = new Date().toISOString().slice(0, 10);
        const count = await db
          .prepare(
            `SELECT COUNT(*) AS c FROM vocab_entries
             WHERE telegram_id = ? AND date(created_at) = date(?)`
          )
          .bind(tgId, today)
          .first();
        if ((count?.c || 0) >= 10) {
          return json({ error: 'Kuniga 10 tadan oshiq so‘z qo‘shib bo‘lmaydi', code: 'DAILY_LIMIT' }, 429);
        }
        await db
          .prepare(
            `INSERT INTO vocab_entries(telegram_id, lesson_id, word, transcription, translation, example, is_shared)
             VALUES(?, ?, ?, ?, ?, ?, 1)`
          )
          .bind(tgId, b.lesson_id || null, b.word, b.transcription || null, b.translation, b.example || null)
          .run();
        const total = await addXp(db, tgId, 3, `Lug‘at: ${b.word}`);
        return json({ ok: true, totalXp: total });
      }

      if (path === '/api/vocab' && method === 'GET') {
        const rows = await db
          .prepare('SELECT * FROM vocab_entries WHERE is_shared = 1 ORDER BY id DESC LIMIT 200')
          .all();
        return json({ items: rows.results || [] });
      }

      // ---------- HOMEWORK ----------
      if (path === '/api/homework' && method === 'POST') {
        const b = await readBody(request);
        const user = await getUser(db, tgId);
        const result = await db
          .prepare(
            `INSERT INTO homework(lesson_id, lesson_title, telegram_id, full_name, answer_text, status)
             VALUES(?, ?, ?, ?, ?, 'pending')`
          )
          .bind(b.lesson_id || null, b.lesson_title || null, tgId, user?.full_name || null, b.answer_text || '')
          .run();
        const hwId = result.meta?.last_row_id;
        if (Array.isArray(b.files)) {
          for (const f of b.files) {
            await db
              .prepare(
                `INSERT INTO homework_files(homework_id, file_type, file_url, file_name) VALUES(?, ?, ?, ?)`
              )
              .bind(hwId, f.file_type || 'file', f.file_url || null, f.file_name || null)
              .run();
          }
        }
        await addXp(db, tgId, 25, 'Uy vazifasi topshirildi');
        return json({ ok: true, id: hwId });
      }

      if (path === '/api/homework' && method === 'GET') {
        const mod = await isModerator(db, tgId);
        const rows = mod
          ? await db.prepare('SELECT * FROM homework ORDER BY id DESC LIMIT 100').all()
          : await db.prepare('SELECT * FROM homework WHERE telegram_id = ? ORDER BY id DESC LIMIT 50').bind(tgId).all();
        return json({ items: rows.results || [] });
      }

      if (path.match(/^\/api\/homework\/\d+\/review$/) && method === 'POST') {
        if (!(await isModerator(db, tgId))) return json({ error: 'Faqat moderator' }, 403);
        const hwId = Number(path.split('/')[3]);
        const b = await readBody(request);
        await db
          .prepare(
            `UPDATE homework SET status = ?, mentor_comment = ?, reviewed_by = ?, reviewed_at = datetime('now')
             WHERE id = ?`
          )
          .bind(b.status || 'reviewed', b.comment || '', tgId, hwId)
          .run();
        return json({ ok: true });
      }

      if (path.match(/^\/api\/homework\/\d+\/reply$/) && method === 'POST') {
        const hwId = Number(path.split('/')[3]);
        const b = await readBody(request);
        const hw = await db.prepare('SELECT * FROM homework WHERE id = ?').bind(hwId).first();
        if (!hw || hw.telegram_id !== tgId) return json({ error: 'Topilmadi' }, 404);
        if (hw.student_reply) return json({ error: 'Javob faqat 1 marta beriladi' }, 400);
        await db.prepare('UPDATE homework SET student_reply = ? WHERE id = ?').bind(b.reply || '', hwId).run();
        return json({ ok: true });
      }

      // ---------- ANNOUNCEMENTS (1 hafta) ----------
      if (path === '/api/announcements' && method === 'POST') {
        if (!(await isModerator(db, tgId))) return json({ error: 'Faqat moderator' }, 403);
        const b = await readBody(request);
        const user = await getUser(db, tgId);
        const expires = new Date(Date.now() + 7 * 86400000).toISOString();
        await db
          .prepare(
            `INSERT INTO announcements(title, body, author_id, author_name, expires_at) VALUES(?, ?, ?, ?, ?)`
          )
          .bind(b.title || '', b.body || '', tgId, user?.full_name || null, expires)
          .run();
        return json({ ok: true });
      }

      if (path === '/api/announcements' && method === 'GET') {
        // Muddati o‘tganlarni tozalash
        await db.prepare(`DELETE FROM announcements WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`).run();
        const rows = await db
          .prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 50')
          .all();
        return json({ items: rows.results || [] });
      }

      // ---------- PEER FEEDBACK ----------
      if (path === '/api/peer-feedback' && method === 'POST') {
        const b = await readBody(request);
        if (!b.to_nickname) return json({ error: 'to_nickname kerak' }, 400);
        const user = await getUser(db, tgId);
        // Nickname bo‘yicha topish
        const target = await db
          .prepare(
            `SELECT telegram_id FROM users WHERE full_name = ? OR username = ? LIMIT 1`
          )
          .bind(b.to_nickname, b.to_nickname)
          .first();
        await db
          .prepare(
            `INSERT INTO peer_feedback(from_id, from_name, to_nickname, to_id, went_well, to_improve)
             VALUES(?, ?, ?, ?, ?, ?)`
          )
          .bind(
            tgId,
            user?.full_name || null,
            b.to_nickname,
            target?.telegram_id || null,
            b.went_well || null,
            b.to_improve || null
          )
          .run();
        await addXp(db, tgId, 20, 'Peer feedback');
        return json({ ok: true, notified: !!target });
      }

      if (path === '/api/meta/groups' && method === 'GET') {
        return json({ groups: GROUPS, levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], badges: BADGE_DEFS });
      }

      return json({ error: 'Topilmadi' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.status ? e.message : 'Server xatosi', detail: String(e.message || e) }, e.status || 500);
    }
  },
};
