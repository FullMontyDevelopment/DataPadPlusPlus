# Cloudflare Pages Website Deployment

The DataPad++ product website lives in `apps/site` and deploys to the Cloudflare Pages project `datapadplusplus`.

## One-Time Cloudflare Setup

1. Create a Cloudflare Pages project named `datapadplusplus`.
2. Use Direct Upload deployments for this project.
3. Create a Cloudflare API token with `Account -> Cloudflare Pages -> Edit`.
4. Add these GitHub Actions secrets to the repository:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`

## Automatic Deployment

The `.github/workflows/cloudflare-pages.yml` workflow runs on pushes to `main` and on manual dispatch.

It installs dependencies, runs `npm run site:build`, and deploys `apps/site/dist` with:

```bash
npx wrangler pages deploy apps/site/dist --project-name=datapadplusplus --branch=<branch>
```

The site includes `apps/site/public/_redirects` so direct routes such as `/docs/install-and-update` serve the React app on Cloudflare Pages.
