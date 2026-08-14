# API Key Get Endpoints

Cloudflare Worker that stores API keys in Cloudflare D1, lets Telegram admins set and retrieve keys, and exposes a REST endpoint that returns a key only after Telegram admin approval.

## Behavior

- Telegram admins can set keys with `/setkey <name> <value>`.
- Telegram admins can retrieve keys directly with `/getkey <name>`.
- Public callers can request a key with `GET /api/keys/:name`.
- Every REST request creates a Telegram approval prompt with **Approve** and **Reject** buttons.
- REST approval requests are valid for 5 minutes. If no admin approves in time, or an admin rejects the request, the REST response is `401` with `{"error":"Rejected"}`.

## Required Cloudflare bindings and secrets

Create a D1 database and update `wrangler.jsonc` with the generated `database_id`.

Secrets / variables:

- `TELEGRAM_BOT_TOKEN`: Telegram bot token.
- `TELEGRAM_ADMIN_USER_IDS`: comma-separated Telegram user IDs allowed to run bot commands and approve REST requests.
- `TELEGRAM_ADMIN_CHAT_IDS`: comma-separated Telegram chat IDs that should receive REST approval requests.
- `TELEGRAM_WEBHOOK_SECRET`: optional Telegram webhook secret checked against `x-telegram-bot-api-secret-token`.

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

## Endpoints

- `POST /telegram/webhook`: Telegram webhook receiver.
- `GET /api/keys/:name`: public key request endpoint that waits up to 5 minutes for admin approval.
- `GET /health`: health check.
