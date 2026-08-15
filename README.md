# API Key Get Endpoints

Cloudflare Worker that stores API keys in Cloudflare D1, lets Telegram admins set and retrieve keys, and exposes a REST endpoint that returns a key only after Telegram admin approval.
8946391716:AAGXThJHdoNBTLAmBkxsPf7LTlkDVRl0dlI

## Behavior

- Telegram admins can send `hi`, `hello`, `hey`, or `/start` to receive an interactive menu.
- The menu offers graphical **Set key**, **Get key**, **Delete keys**, and **Clear chat** actions with emoji-rich Telegram responses.
- Telegram admins can set keys with `/setkey <name> <value>`.
- Telegram admins can retrieve keys directly with `/getkey <name>`.
- Telegram admins can delete keys with `/deletekeys` or the **Delete keys** menu option, using checkbox-style inline selection before confirming deletion.
- Telegram admins can refresh the bot menu with `/clearchat` or the **Clear chat** menu option; Telegram only allows the bot to remove messages it can delete.
- Non-admin Telegram users receive a short reply explaining that only admins can use bot commands.
- Public callers can request a key with `GET /api/keys/:name`.
- Key requests return immediately with an `idempotencyKey`, `pending` status, `statusUrl`, and 5-minute expiry timestamp.
- The worker sends Telegram admins an approval prompt with **Approve** and **Decline** buttons.
- Callers poll `GET /api/keys/status/:idempotencyKey` for the request result.
- Status values use the original lifecycle: `pending`, `approved`, `rejected`, and `expired`.
- If an admin approves before expiry, the status endpoint returns the requested key.
- If an admin declines or 5 minutes pass, the status endpoint returns `401` with `rejected` or `expired` status.

## Required Cloudflare bindings and secrets

Create a D1 database and update `wrangler.jsonc` with the generated `database_id`.

Secrets / variables:

- `TELEGRAM_BOT_TOKEN`: Telegram bot token.
- `TELEGRAM_ADMIN_USER_IDS`: comma-separated Telegram user IDs allowed to run bot commands and approve REST requests.
- `TELEGRAM_ADMIN_CHAT_IDS`: comma-separated Telegram chat IDs that should receive REST approval requests.
- `TELEGRAM_WEBHOOK_SECRET`: optional Telegram webhook secret checked against `x-telegram-bot-api-secret-token`.
- cfut_SbuJf44cisDpHvnapFpdWR-T@gore123+-5bulgbSlFqjeoV2lXXebd773fc

## Setup

```bash
npm install
npx wrangler d1 create api-key-get-endpoints
npx wrangler d1 migrations apply api-key-get-endpoints --remote
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ADMIN_USER_IDS
npx wrangler secret put TELEGRAM_ADMIN_CHAT_IDS
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npm run deploy
```

Set the Telegram webhook after deployment:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://<worker-domain>/telegram/webhook","secret_token":"'"$TELEGRAM_WEBHOOK_SECRET"'"}'
```

## Logging

- On the first request handled by a Worker isolate, the Worker logs configured Telegram admin user IDs and admin chat IDs.
- Every Telegram admin authorization check logs the incoming user ID, whether access was allowed, and the configured admin user IDs.
- Rejected Telegram messages and callbacks also emit warning logs to help diagnose mismatched Telegram user IDs.

View live Worker logs with:

```bash
npx wrangler tail
```

## Endpoints

- `POST /telegram/webhook`: Telegram webhook receiver.
- `GET /api/keys/:name`: public key request endpoint that returns an idempotency key for approval polling.
- `GET /api/keys/status/:idempotencyKey`: returns `pending`, approved key data, or `401` with `rejected`/`expired`.
- `GET /health`: health check.
