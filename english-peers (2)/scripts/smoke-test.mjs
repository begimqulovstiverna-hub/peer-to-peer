// Mahalliy sinov: node scripts/smoke-test.mjs  (Node 22+, tarmoq kerak emas)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import worker from '../src/index.js';

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db.exec(fs.readFileSync(new URL('../seed.sql', import.meta.url), 'utf8'));
const d1 = { prepare(sql) { let a = []; const st = {
  bind(...x) { a = x; return st; },
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async all() { return { results: db.prepare(sql).all(...a) }; } }; return st; },
  async batch(s) { const o = []; for (const x of s) o.push(await x.run()); return o; } };

const sent = []; globalThis.fetch = async (u, o) => { sent.push(JSON.parse(o.body)); return new Response('{}'); };
const TOKEN = '123456:TEST';
const env = { DB: d1, BOT_TOKEN: TOKEN, WEBHOOK_SECRET: 'sec', INITIAL_MASTER_KEY: 'mk', INITIAL_MOD_KEY: 'tk', ASSETS: { fetch: () => new Response('asset') } };

function initData(id) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'U' + id, username: 'u' + id }) });
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
async function api(method, path, id, body) {
  const headers = { 'content-type': 'application/json' };
  if (id) headers.authorization = 'tma ' + initData(id);
  const r = await worker.fetch(new Request('https://x.dev/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, data: await r.json() };
}
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK   ' : 'XATO ') + msg); if (!c) fails++; };
const prof = (n, g = 101) => ({ full_name: 'Test Foydalanuvchi ' + n, nickname: 'nick' + n, group_no: g, level: 'A1', experiences: ['speaking'] });
const xp = (id) => db.prepare('SELECT xp FROM users WHERE id=?').get(id).xp;

ok((await api('GET', '/me', null)).status === 401, 'tokensiz so‘rov rad etiladi');
const bad = await worker.fetch(new Request('https://x.dev/api/me', { headers: { authorization: 'tma ' + initData(1).replace(/hash=.{4}/, 'hash=0000') } }), env);
ok(bad.status === 401, 'soxta imzo rad etiladi');

let r = await api('POST', '/register', 1, prof(1)); ok(r.status === 200 && r.data.user.xp === 50, 'ro‘yxatdan o‘tish +50 XP');
ok((await api('POST', '/register', 2, { ...prof(2), nickname: 'NICK1' })).status === 409, 'band nickname rad etiladi');
await api('POST', '/register', 2, prof(2)); await api('POST', '/register', 3, prof(3, 102));
ok((await api('GET', '/me', 1)).data.user.direction.includes('Axborot'), 'guruhdan yo‘nalish aniqlanadi');

ok((await api('POST', '/claim-role', 2, { key: 'xato' })).status === 403, 'noto‘g‘ri kalit rad etiladi');
ok((await api('POST', '/claim-role', 2, { key: 'tk' })).data.role === 'moderator', 'vaqtinchalik moderator kaliti ishlaydi');
ok((await api('POST', '/claim-role', 1, { key: 'mk' })).data.role === 'super_admin', 'bosh kalit ishlaydi');
ok((await api('POST', '/schedules', 3, { topic: 'x', starts_at: 1 })).status === 403, 'oddiy a’zo dars qo‘sha olmaydi');

const list3 = (await api('GET', '/schedules', 3)).data.schedules;
ok(list3.length === 6 && list3[0].questions.every((q) => q.correctIndex === undefined), '6 dars yuklandi, to‘g‘ri javoblar a’zoga ko‘rinmaydi');
const list2 = (await api('GET', '/schedules', 2)).data.schedules;
ok(list2[0].questions.some((q) => q.correctIndex !== undefined), 'moderatorga to‘g‘ri javoblar ko‘rinadi');

// Test baholash: 3 ta yashil natija = +50 XP
const lessons = db.prepare('SELECT id,questions FROM schedules ORDER BY id LIMIT 3').all();
const before = xp(3); let last;
for (const l of lessons) { const answers = {}; JSON.parse(l.questions).forEach((q) => (answers[q.id] = q.correctIndex)); last = await api('POST', `/schedules/${l.id}/test`, 3, { answers }); }
ok(last.data.green && last.data.bonus_xp === 50 && xp(3) === before + 50, '3 ta yashil testdan +50 XP');
await api('POST', `/schedules/${lessons[0].id}/test`, 3, { answers: {} });
ok(db.prepare('SELECT score FROM test_results WHERE user_id=3 AND schedule_id=?').get(lessons[0].id).score === 30, 'eng yaxshi natija saqlanadi');

// Eslatmalar
const t = Date.now();
const mk = await api('POST', '/schedules', 1, { topic: 'Eslatma sinovi', starts_at: t + 100 * 60000, location: 'B-204' });
await api('POST', `/schedules/${mk.data.id}/rsvp`, 3, {});
sent.length = 0; await worker.scheduled({}, env, { waitUntil: (p) => p }); await new Promise((r) => setTimeout(r, 50));
ok(sent.some((m) => m.chat_id === 3 && m.text.includes('Eslatma sinovi')), 'eslatma Telegramga yuborildi');
const n1 = sent.length; await worker.scheduled({}, env, { waitUntil: (p) => p }); await new Promise((r) => setTimeout(r, 50));
ok(sent.length === n1, 'eslatma takrorlanmaydi');
await api('PATCH', '/me', 3, { notify: false });
const mk2 = await api('POST', '/schedules', 1, { topic: 'Ikkinchi', starts_at: t + 100 * 60000 });
await api('POST', `/schedules/${mk2.data.id}/rsvp`, 3, {}); sent.length = 0;
await worker.scheduled({}, env, { waitUntil: (p) => p }); await new Promise((r) => setTimeout(r, 50));
ok(!sent.some((m) => m.chat_id === 3), 'bildirishnoma o‘chiq bo‘lsa eslatma yuborilmaydi');

// Davomat
const a0 = xp(3);
await api('POST', `/schedules/${mk.data.id}/attendance`, 1, { user_id: 3, status: 'absent' });
ok(xp(3) === a0 - 80, 'sababsiz qatnashmaslik −80 XP');
await api('POST', `/schedules/${mk.data.id}/attendance`, 1, { user_id: 3, status: 'absent' });
ok(xp(3) === a0 - 80, 'takroriy belgilash XP ni qayta ayirmaydi');

// Speaker
const far = await api('POST', '/schedules', 1, { topic: 'Uzoq', starts_at: t + 3 * DAY() });
const near = await api('POST', '/schedules', 1, { topic: 'Yaqin', starts_at: t + 10 * 3600000 });
function DAY() { return 86400000; }
await api('POST', `/schedules/${far.data.id}/rsvp`, 3, { speaker: true });
ok((await api('POST', `/schedules/${far.data.id}/rsvp`, 2, { speaker: true })).status === 409, 'speaker faqat bitta');
const s0 = xp(3); await api('DELETE', `/schedules/${far.data.id}/speaker`, 3);
ok(xp(3) === s0 - 90, '24 soatdan oldin voz kechish −90 XP');
await api('POST', `/schedules/${near.data.id}/rsvp`, 3, { speaker: true });
ok((await api('DELETE', `/schedules/${near.data.id}/speaker`, 3)).status === 409, '24 soat ichida voz kechib bo‘lmaydi');
const d0 = xp(3); await api('POST', `/schedules/${near.data.id}/speaker-done`, 1);
ok(xp(3) === d0 + 300 + 200, 'speakerlik +300 va birinchi speakerlik nishoni +200');
ok((await api('PATCH', `/schedules/${near.data.id}`, 2, { speaker_id: 2, topic: 'Yangi' })).status === 200 && db.prepare('SELECT speaker_id FROM schedules WHERE id=?').get(near.data.id).speaker_id === 3, 'moderator speakerni o‘zgartira olmaydi');

// Lug'at limiti
let st; for (let i = 0; i < 11; i++) st = await api('POST', '/vocab', 3, { word: 'w' + i, translation: 't' });
ok(st.status === 429, 'kuniga 10 tadan ortiq so‘z rad etiladi');

// Fikr 1 marta javob
await api('POST', '/feedback', 2, { nickname: 'nick3', body: 'Zo‘r!' });
const fid = db.prepare('SELECT id FROM peer_feedback').get().id;
ok((await api('POST', `/feedback/${fid}/reply`, 3, { text: 'Rahmat' })).status === 200 && (await api('POST', `/feedback/${fid}/reply`, 3, { text: 'Yana' })).status === 409, 'fikrga faqat 1 marta javob');

// Kalit almashsa moderatorlik bekor
ok((await api('POST', '/admin/keys', 1, { temp_key: 'yangi' })).status === 200 && (await api('POST', '/schedules', 2, { topic: 'x', starts_at: 1 })).status === 403, 'moderator kaliti almashsa eski moderatorlar darhol bekor bo‘ladi');
ok((await api('POST', '/claim-role', 2, { key: 'tk' })).status === 403 && (await api('POST', '/claim-role', 2, { key: 'yangi' })).data.role === 'moderator', 'eski kalit ishlamaydi, yangisi ishlaydi');

console.log(fails ? `\n${fails} ta xato` : '\nHammasi o‘tdi');
process.exit(fails ? 1 : 0);
