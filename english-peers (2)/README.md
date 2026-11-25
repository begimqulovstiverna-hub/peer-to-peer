# English Peers — sayt + Telegram Mini App

Hammasi bitta Cloudflare Worker'da: sayt (public/), API, Telegram bot, eslatmalar (cron) va D1 bazasi.

## Holat
- ✅ Server (src/index.js): Telegram login, ro'yxatdan o'tish, XP/nishonlar, darslar, davomat, speaker qoidalari, test baholash, e'lonlar (1 hafta), tengdosh fikri, topshiriqlar, lug'at (kuniga 10), moderator kalitlari, eslatmalar (24s / 6s / 2s / 30 daq).
- ✅ 6 ta mavjud dars bazaga yuklanadi (seed.sql).
- ⏳ public/index.html hozircha eski nusxa (ma'lumot qurilmada). Keyingi bosqich: uni /api ga ulash (public/api.js tayyor).

## O'rnatish (bir marta)
1. **Bot:** Telegram'da @BotFather → `/newbot` → token oling.
2. **GitHub:** bu papkani yangi repoga yuklang.
3. Terminalda:
   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create english-peers      # chiqqan database_id ni wrangler.toml ga yozing
   npm run db:init
   npm run db:seed
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET     # uzun tasodifiy satr
   npx wrangler secret put INITIAL_MASTER_KEY # YANGI bosh kalit (eskisini ishlatmang)
   npx wrangler secret put INITIAL_MOD_KEY    # YANGI moderator kaliti
   npm run deploy
   ```
4. Deploy bergan manzilni (`https://english-peers.xxx.workers.dev`) `wrangler.toml` dagi `APP_URL` ga yozib, yana `npm run deploy`.
5. Botni ulash (TOKEN, SECRET, URL ni almashtiring):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=<URL>/bot" -d "secret_token=<SECRET>"
   curl "https://api.telegram.org/bot<TOKEN>/setChatMenuButton" \
     -H "content-type: application/json" \
     -d '{"menu_button":{"type":"web_app","text":"English Peers","web_app":{"url":"<URL>"}}}'
   ```
6. Botga `/start` yozing — "ochish" tugmasi chiqadi.

## GitHub'dan avtomatik deploy
Cloudflare → Workers & Pages → Create → Import a repository → shu repo. Deploy command: `npx wrangler deploy`. Secret'lar Cloudflare panelida (Settings → Variables and Secrets) kiritiladi.

## Qoidalar (src/index.js boshida o'zgartiriladi)
- Ro'yxatdan o'tish +50, sababsiz qatnashmaslik −80, speakerlikdan voz kechish −90, speakerlik bajarilishi +300 (moderator tasdiqlaydi), lug'atga so'z +3.
- Nishonlar: ketma-ket 5 dars → Haqiqiy o'quvchi; jami 10 dars → Maqsad sari boruvchi; Listening/Writing/Speaking topshiriqlari moderator "qabul" qilganda; Ko'makchi — moderator `/api/admin/award` orqali.
- Test "yashil" = 30 tadan 26 dan ko'p (boshqa uzunlikdagi testda shu nisbat). Har 3 ta yashil natijadan +50 XP.
- Speakerlikdan voz kechish faqat dars boshlanishiga 24 soatdan ko'p qolganda; shundan keyin −90 XP.
- Moderator kaliti almashtirilsa, eski kalit bilan olingan moderatorliklar darhol bekor bo'ladi.
- Vaqtlar Toshkent (UTC+5) bo'yicha ko'rsatiladi.

## Sinov
`node scripts/smoke-test.mjs` — serverni soxta baza bilan tekshiradi (tarmoq kerak emas).

## Eslatmalar
- Foydalanuvchi botga kamida bir marta `/start` yozgan bo'lishi kerak, aks holda Telegram xabar yuborishga ruxsat bermaydi.
- Moderator yozgan "bezakli" matnni ekranga chiqarishda tozalang (DOMPurify) — aks holda xavfsizlik teshigi bo'ladi.
- Audio/video yuklash uchun R2 kerak (`wrangler.toml` da izoh ichida). Cloudflare R2 uchun karta so'rashi mumkin; hozircha matnli topshiriqlar ishlaydi.
- Telegram ichida mikrofon orqali talaffuzni tekshirish ba'zi telefonlarda ishlamasligi mumkin — haqiqiy qurilmada sinab ko'ring.
