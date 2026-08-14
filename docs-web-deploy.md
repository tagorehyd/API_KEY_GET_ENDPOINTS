# Web-only deploy with GitHub Actions

Use this guide if you do not want to run local terminal commands. The workflow in `.github/workflows/deploy.yml` deploys the Worker from GitHub Actions after you add Cloudflare credentials as GitHub repository secrets.

## What GitHub will ask you to save

Add these repository secrets in GitHub at **Settings > Secrets and variables > Actions > New repository secret**:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token that can edit Workers and D1.
- `CLOUDFLARE_D1_DATABASE_ID`: optional. If omitted, the workflow will find or create the `api-key-get-endpoints` D1 database automatically.

Do not commit these values to the repository.

## Cloudflare dashboard setup

1. Create a Cloudflare API token and save it in GitHub as `CLOUDFLARE_API_TOKEN`.
2. Copy your Cloudflare account ID and save it in GitHub as `CLOUDFLARE_ACCOUNT_ID`.
3. Optional: create a D1 database named `api-key-get-endpoints` and save its ID as `CLOUDFLARE_D1_DATABASE_ID`. If you skip this, GitHub Actions will create or reuse that D1 database for you.

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

The workflow installs dependencies, validates the Worker syntax, finds or creates the D1 database, injects the D1 database ID into `wrangler.jsonc` inside the temporary GitHub runner, applies D1 migrations, and deploys the Worker.

## Automatic deploys

After the GitHub secrets are configured, every push to `main` also runs the same deployment workflow.
