import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database(process.env.DB_PATH || path.join(__dirname,'peers.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY, username TEXT, profile_json TEXT, state_json TEXT,
  role TEXT NOT NULL DEFAULT 'learner', mod_expires INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT, action TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
app.use(express.json({limit:'20mb'}));
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MASTER_KEY = process.env.MASTER_KEY || '';
const MODERATOR_KEY = process.env.MODERATOR_KEY || '';
const MODERATOR_MINUTES = Number(process.env.MODERATOR_MINUTES || 60);
const sessions = new Map();

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) throw new Error('Telegram bot token yoki initData yo‘q');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Telegram initData hash yo‘q');
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(expected,'hex'))) throw new Error('Telegram imzo tekshiruvi muvaffaqiyatsiz');
  const authDate = Number(params.get('auth_date') || 0);
  if (Date.now()/1000-authDate > 86400) throw new Error('Telegram sessiyasi eskirgan');
  const user = JSON.parse(params.get('user') || '{}');
  if (!user.id) throw new Error('Telegram foydalanuvchisi topilmadi');
  return user;
}
function auth(req,res,next) {
  const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  const id=sessions.get(bearer);
  if(!id) return res.status(401).json({error:'Avtorizatsiya talab qilinadi'});
  req.tgId=id; next();
}
app.post('/api/auth/telegram',(req,res)=>{
  try {
    const user=validateTelegramInitData(req.body.initData);
    const id=String(user.id);
    db.prepare('INSERT OR IGNORE INTO users(telegram_id,username) VALUES(?,?)').run(id,user.username||'');
    db.prepare('UPDATE users SET username=? WHERE telegram_id=?').run(user.username||'',id);
    const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,id);
    const row=db.prepare('SELECT profile_json,state_json,role,mod_expires FROM users WHERE telegram_id=?').get(id);
    res.json({token,user,profile:row.profile_json?JSON.parse(row.profile_json):null,state:row.state_json?JSON.parse(row.state_json):null,role:row.role,modExpires:row.mod_expires});
  } catch(e){ res.status(401).json({error:e.message}); }
});
app.get('/api/state',auth,(req,res)=>{
  const row=db.prepare('SELECT profile_json,state_json,role,mod_expires FROM users WHERE telegram_id=?').get(req.tgId);
  const state=row.state_json?JSON.parse(row.state_json):{};
  res.json({...state,profile:row.profile_json?JSON.parse(row.profile_json):state.profile||null,role:row.role,modExpires:row.mod_expires});
});
app.put('/api/state',auth,(req,res)=>{
  const body=req.body||{};
  const profile=body.profile||null;
  const state={...body}; delete state.profile;
  db.prepare('UPDATE users SET profile_json=?,state_json=? WHERE telegram_id=?').run(profile?JSON.stringify(profile):null,JSON.stringify(state),req.tgId);
  res.json({ok:true});
});
app.put('/api/profile',auth,(req,res)=>{
  const p=req.body||{};
  if(!p.fullName||!p.group||!p.level) return res.status(400).json({error:'Profil ma’lumotlari to‘liq emas'});
  db.prepare('UPDATE users SET profile_json=? WHERE telegram_id=?').run(JSON.stringify(p),req.tgId);
  res.json({ok:true,profile:p});
});
app.post('/api/moderator/activate',auth,(req,res)=>{
  const key=String(req.body?.key||'');
  const role=key===MASTER_KEY?'super_admin':key===MODERATOR_KEY?'temp_moderator':null;
  if(!role) return res.status(403).json({valid:false,error:'Kalit noto‘g‘ri'});
  const expires=role==='temp_moderator'?Date.now()+MODERATOR_MINUTES*60000:null;
  db.prepare('UPDATE users SET role=?,mod_expires=? WHERE telegram_id=?').run(role,expires,req.tgId);
  db.prepare('INSERT INTO audit(telegram_id,action) VALUES(?,?)').run(req.tgId,`Moderator role: ${role}`);
  res.json({valid:true,role,expiresAt:expires});
});
app.get('/health',(req,res)=>res.json({ok:true}));
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`English Peers server listening on ${port}`));
