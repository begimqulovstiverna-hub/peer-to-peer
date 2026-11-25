# English Peers — Website + Telegram Mini App

Bepul ingliz tili klubi: profil, XP, nishonlar, darslar, davomat, test, lug‘at, talaffuz, vazifa va jamoa.

## Stack
- **Frontend:** `index.html` (Tailwind CDN, Telegram WebApp SDK)
- **API client:** `api.js`
- **Production backend:** Cloudflare Worker + D1 (`worker.js`, `wrangler.jsonc`)
- **Local backend:** Express + SQLite (`server.js`) — ixtiyoriy
- **Bot menu:** `bot.js`

## peers.txt qoidalari (serverda)

| Qoida | Holat |
|-------|--------|
| Registratsiya + profil saqlash | ✅ +50 XP |
| Guruhlar 101–107, A1–C2 | ✅ |
| Moderator kaliti (MASTER / MOD) | ✅ |
| XP log | ✅ |
| Nishonlar (avto + moderator) | ✅ |
| Speaker claim / 24h bekor / +300 tasdiq | ✅ |
| Davomat, sababsiz −80 XP | ✅ |
| 5 ketma-ket / 10 dars nishonlari | ✅ |
| Test 26+/30 → test_master +50 | ✅ |
| Lug‘at +3 XP, kuniga max 10 | ✅ |
| Uy vazifa + feedback + 1 javob | ✅ |
| E’lonlar 7 kunda o‘chadi | ✅ |
| Peer feedback | ✅ |
| Bildirishnomalar (24/6/2/0.5h) | ⏳ bot + cron keyingi bosqich |
| Media fayl (R2) | ⏳ keyingi bosqich |
| Listening/Writing/Speaking nishon oqimi | ⏳ UI + moderator panel |

## Deploy (Cloudflare)

1. **D1 schema**  
   Cloudflare → D1 → `english-peers-db` → Console → `schema.sql` ni to‘liq Execute qiling.

2. **Secrets** (Worker → Settings → Variables):
   - `BOT_TOKEN`
   - `MASTER_KEY`
   - `MODERATOR_KEY`
   - `MODERATOR_MINUTES` (ixtiyoriy, default 60)

3. **Fayllar**  
   GitHub repo ga yuklang: `worker.js`, `wrangler.jsonc`, `.assetsignore`, `index.html`, `api.js`, `schema.sql`.

4. **Tekshiruv**  
   `https://<your-worker>.workers.dev/health` → `{"ok":true,"version":"2.0"}`

5. **Telegram**  
   BotFather da Web App URL ni Worker manziliga qo‘ying. `bot.js` localda `WEB_APP_URL` bilan ishlatiladi.

## Local

```bash
cp .env.example .env   # BOT_TOKEN, MASTER_KEY, MODERATOR_KEY
npm install
npm start              # http://localhost:3000
npm run bot            # alohida terminal
```

> Eslatma: local `server.js` hozircha eski minimal API ni ushlab turadi. Asosiy ishlab chiqish `worker.js` da. Keyingi qadamda `server.js` ni ham Worker bilan bir xil qilish mumkin.

## Frontend ↔ API

Telegram Mini App ichida `EPApi.initialize()` chaqiriladi.  
Registratsiya, speaker, davomat, test, lug‘at, vazifa serverga yoziladi (token bo‘lsa).  
Token yo‘q bo‘lsa (brauzer demo) — localStorage ishlayveradi.
