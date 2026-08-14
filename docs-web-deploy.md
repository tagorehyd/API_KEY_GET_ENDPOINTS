# Web-only deploy with GitHub Actions

Use this guide if you do not want to run local terminal commands. The workflow in `.github/workflows/deploy.yml` deploys the Worker from GitHub Actions after you add Cloudflare credentials as GitHub repository secrets.

## What GitHub will ask you to save

Add these repository secrets in GitHub at **Settings > Secrets and variables > Actions > New repository secret**:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with the account-level permissions listed below. The deploy step calls the Workers service API, so a token that only has D1, KV, R2, Workers Builds, or Workers Agents permissions will still fail with Cloudflare API error `10000` until **Workers Scripts: Edit** is added.
- `CLOUDFLARE_D1_DATABASE_ID`: optional. If omitted, the workflow will find or create the `api-key-get-endpoints` D1 database automatically.

Do not commit these values to the repository.

## Cloudflare dashboard setup

1. Create a Cloudflare API token and save it in GitHub as `CLOUDFLARE_API_TOKEN`.
2. Give the token these account-level permissions for the account you deploy to:
   - **Workers Scripts: Edit** (required for `wrangler deploy`; without it Cloudflare returns authentication error `10000` from `/workers/services/api-key-get-endpoints`).
   - **D1: Edit** (required to list/create the D1 database and apply migrations).
   - Optional only if you later add these bindings: **Workers KV Storage: Edit**, **Workers R2 Storage: Edit**, or other product-specific permissions.
   - The screenshot-style permissions **Workers Builds Configuration: Edit** and **Workers Agents Configuration: Edit** do not replace **Workers Scripts: Edit** for Worker deployment.
3. Scope the token to the target account under **Account Resources**.
4. Copy your Cloudflare account ID and save it in GitHub as `CLOUDFLARE_ACCOUNT_ID`.
5. Optional: create a D1 database named `api-key-get-endpoints` and save its ID as `CLOUDFLARE_D1_DATABASE_ID`. If you skip this, GitHub Actions will create or reuse that D1 database for you.

## Runtime Worker secrets

In Cloudflare Worker settings, add these runtime secrets/variables before using Telegram:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_USER_IDS`
- `TELEGRAM_ADMIN_CHAT_IDS`
- `TELEGRAM_WEBHOOK_SECRET`

## Deploy from GitHub web UI

1. Open the repository on GitHub.
2. Go to the **Actions** tab.
3. Select **Deploy Cloudflare Worker**.
4. Click **Run workflow**.
5. Wait for the workflow to complete.

The workflow installs dependencies on Node.js 24, validates the Worker syntax, finds or creates the D1 database, injects the D1 database ID into `wrangler.jsonc` inside the temporary GitHub runner, applies D1 migrations, verifies the Cloudflare token with `wrangler whoami`, and deploys the Worker with the local Wrangler version from `package-lock.json`.

## Automatic deploys

After the GitHub secrets are configured, every push to `main` also runs the same deployment workflow.
