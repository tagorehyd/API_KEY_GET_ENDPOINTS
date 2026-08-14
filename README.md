# API Key Get Endpoints

Cloudflare Worker that stores API keys in one JSON file in Cloudflare R2, lets Telegram admins set and retrieve keys, and exposes a REST endpoint that returns a key only after Telegram admin approval.

## Behavior

- Telegram admins can set keys with `/setkey <name> <value>`.
- Telegram admins can retrieve keys directly with `/getkey <name>`.
- Public callers can request a key with `GET /api/keys/:name`.
- Every REST request creates a Telegram approval prompt with **Approve** and **Reject** buttons.
- REST approval requests are valid for 5 minutes. If no admin approves in time, or an admin rejects the request, the REST response is `401` with `{"error":"Rejected"}`.

## Required Cloudflare bindings and secrets

Create an R2 bucket named `api-key-get-endpoints`, or let the GitHub Actions workflow create it. The Worker binding name is `BUCKET`, and the default storage object is `api-key-store.json`.

Secrets / variables:

- `TELEGRAM_BOT_TOKEN`: Telegram bot token.
- `TELEGRAM_ADMIN_USER_IDS`: comma-separated Telegram user IDs allowed to run bot commands and approve REST requests.
- `TELEGRAM_ADMIN_CHAT_IDS`: comma-separated Telegram chat IDs that should receive REST approval requests.
- `TELEGRAM_WEBHOOK_SECRET`: optional Telegram webhook secret checked against `x-telegram-bot-api-secret-token`.
- `R2_STORE_OBJECT_KEY`: optional R2 object key for the JSON storage file; defaults to `api-key-store.json`.

## Web-only GitHub Actions deploy

If you are deploying from the GitHub web UI, add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as GitHub Actions secrets, then run the **Deploy Cloudflare Worker** workflow from the Actions tab. Use a token with Workers Scripts and R2 edit permissions. The workflow can create the R2 bucket automatically. See `docs-web-deploy.md` for the full no-terminal guide.

## Setup

```bash
npm install
npx wrangler r2 bucket create api-key-get-endpoints
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
