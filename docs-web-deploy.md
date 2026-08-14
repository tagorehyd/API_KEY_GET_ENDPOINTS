# Web-only deploy with GitHub Actions

Use this guide if you do not want to run local terminal commands. The workflow in `.github/workflows/deploy.yml` deploys the Worker from GitHub Actions after you add Cloudflare credentials as GitHub repository secrets.

## What GitHub will ask you to save

Add these repository secrets in GitHub at **Settings > Secrets and variables > Actions > New repository secret**:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token that can edit Workers and R2. The easiest option is Cloudflare's **Edit Cloudflare Workers** API token template plus R2 edit access; if you use a custom token, include `Workers Scripts:Edit` and `Workers R2 Storage:Edit` for the same account.

Do not commit these values to the repository.

## Cloudflare dashboard setup

1. Create a Cloudflare API token and save it in GitHub as `CLOUDFLARE_API_TOKEN`. Use Cloudflare's **Edit Cloudflare Workers** template plus R2 edit access, or a custom token with `Workers Scripts:Edit` and `Workers R2 Storage:Edit`.
2. Copy your Cloudflare account ID and save it in GitHub as `CLOUDFLARE_ACCOUNT_ID`.
3. Optional: create an R2 bucket named `api-key-get-endpoints`. If you skip this, GitHub Actions will try to create it for you.

## Runtime Worker secrets

In Cloudflare Worker settings, add these runtime secrets/variables before using Telegram:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_USER_IDS`
- `TELEGRAM_ADMIN_CHAT_IDS`
- `TELEGRAM_WEBHOOK_SECRET`
- `R2_STORE_OBJECT_KEY` optional; defaults to `api-key-store.json`.

## Deploy from GitHub web UI

1. Open the repository on GitHub.
2. Go to the **Actions** tab.
3. Select **Deploy Cloudflare Worker**.
4. Click **Run workflow**.
5. Wait for the workflow to complete.

The workflow installs dependencies, validates the Worker syntax, creates the R2 bucket if needed, and deploys the Worker. API keys and pending approval requests are stored in one JSON file in R2.

## Automatic deploys

After the GitHub secrets are configured, every push to `main` also runs the same deployment workflow.

## If you see Cloudflare authentication error code 10000

That means Cloudflare accepted a token but the token cannot access the requested account/API. In the Cloudflare dashboard, recreate `CLOUDFLARE_API_TOKEN` with Workers and R2 edit access, and make sure it is scoped to the same account as `CLOUDFLARE_ACCOUNT_ID`.
