# English Peers — website + Telegram Mini App

This package contains the edited frontend and a deployable Express/SQLite backend starter.

## Run locally
1. Install Node.js 20+.
2. `cp .env.example .env` and set a real Telegram bot token and strong secret keys.
3. `npm install`
4. `npm start`
5. Open `http://localhost:3000` for browser preview.
6. To run the Telegram bot/menu helper, use `npm run bot` (in a second terminal). Telegram authentication works only when opened as a Mini App with valid Telegram `initData`.

## Telegram setup
- Create a bot with BotFather and set `BOT_TOKEN`.
- Set `WEB_APP_URL` to the deployed HTTPS site URL; `npm run bot` sets the bot's menu button and handles `/start` and `/app`.
- Host this app at HTTPS and set the URL as the bot's Web App URL / menu button.
- Configure the Mini App domain with BotFather.
- For production, use a reverse proxy (Nginx/Caddy) with HTTPS and persistent storage for `peers.sqlite`.

## Important
- The original single-file app was preserved except for requested onboarding group/level/experience options, initial profile metadata, accepted TTS speeds, and a remote-state sync hook.
- Backend persists Telegram-authenticated profile/state to SQLite and validates Telegram Web App initData.
- Existing front-end features still include prototype/local-only flows. The full specification in `peers.txt` (moderator-managed content, badges, homework media, automated reminders, full attendance/XPs, weekly lesson lifecycle, speech scoring, notification delivery, etc.) requires additional API endpoints, scheduled jobs, file storage and UI work. This starter does not claim those unfinished items are production-complete.
- Moderator credentials are server environment variables; rotate them before deployment. Existing client-side moderator UI in the legacy HTML is a prototype and should be replaced with server-authorized moderator endpoints before public launch.
