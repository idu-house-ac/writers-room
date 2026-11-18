# Deploying Writers Room

The app is one container: the API, the web files and the live-collaboration WebSocket all run in one Node process on one port (3000). It needs a Postgres 16 database and these environment variables:

| Variable | What |
|---|---|
| `DATABASE_URL` | `postgres://user:password@host:5432/dbname` |
| `SESSION_SECRET` | long random string (32+ characters); signs session cookies |
| `APP_ORIGIN` | the public URL users open, e.g. `https://writers.example.com`. Links in emails use it and cross-site requests are refused against it. Must match exactly, no trailing slash. |
| `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_NAME`, `BOOTSTRAP_OWNER_PASSWORD` | the first account, created on start if it does not exist |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | outgoing email; optional (see below) |
| `NODE_ENV=production`, `WEB_DIST=/app/apps/web/dist`, `PORT=3000` | set by the Dockerfile |

Health check: `GET /api/health` returns `{"ok":true}`. Migrations run automatically on start.

**Email.** Invitations and password resets are emailed. Without `SMTP_HOST` the server prints each email to its log instead, and an Owner can copy the invitation link from the Share dialog right after sending it. For a real provider, any SMTP service works (for example Postmark, Resend, Mailgun, Amazon SES or a Google Workspace account with an app password). Set the five `SMTP_*` variables and `MAIL_FROM`.

## Which host

The app must run as a long-lived process because of the WebSocket connections, so it needs a container or VM host, not a static or serverless one.

- **Vercel** hosts static sites and short-lived functions. It can serve the web files but cannot run the API, the collaboration server or Postgres. Running the front end on Vercel against an API hosted elsewhere is possible but adds cross-site cookie and CORS configuration that this build does not include. Not recommended for v1.
- **Railway, Render, Fly.io** (and similar) run a Dockerfile, keep WebSockets open and offer managed Postgres. Easiest route with no server to maintain. Costs are usage based; check each provider's current pricing and free-tier limits, which change often.
- **A VPS** (Hetzner, DigitalOcean, Linode, ...) with Docker: the included `docker-compose.prod.yml` runs everything, including HTTPS via Caddy and nightly backups. Cheapest and fully self-hosted, which is what the brief assumed; you own backups and updates.

## Option A (recommended): Railway, step by step

Checked against Railway's docs on 2026-11-18; the dashboard changes over time, so if a button has moved, the setting's name is still the thing to look for. Railway's "config as code" files are deprecated, so everything below is done in the dashboard.

1. Go to railway.com and sign up with your GitHub account (the one that can see the `idu-house-ac/writers-room` repository). Railway will ask for a payment method or a plan before it deploys; check their current pricing.
2. **New Project → Deploy from GitHub repo** → pick `idu-house-ac/writers-room`. If the repository is not listed, use the link to configure the Railway GitHub app and grant it access to the `idu-house-ac` organisation.
3. The first build will fail or build the wrong thing because the Dockerfile is not at the repository root. That is expected. Open the new service → **Variables** → **New Variable** and add:
   - `RAILWAY_DOCKERFILE_PATH` = `deploy/Dockerfile`
4. Add the database: back on the project canvas click **+ New → Database → PostgreSQL**. A service named `Postgres` appears.
5. Open the app service again → **Variables**, and add these (use the **RAW Editor** to paste them all at once):
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=<paste a long random string, 32+ characters>
   APP_ORIGIN=https://<filled in at step 7>
   BOOTSTRAP_OWNER_EMAIL=you@example.com
   BOOTSTRAP_OWNER_NAME=Your Name
   BOOTSTRAP_OWNER_PASSWORD=<a strong password>
   NODE_ENV=production
   ```
   `${{Postgres.DATABASE_URL}}` is a reference to the database service's own variable; type it exactly like that. To make a random secret on a Mac: `openssl rand -hex 32` in Terminal.
6. **Settings → Deploy → Healthcheck Path**: `/api/health`.
7. **Settings → Networking → Public Networking → Generate Domain**. When asked for a port, enter `3000`. Copy the domain Railway gives you (something like `writers-room-production.up.railway.app`) and set `APP_ORIGIN` in Variables to `https://` + that domain, with no trailing slash. Deploy the staged variable changes.
8. Wait for the deployment to show as healthy, then open the domain. Sign in with the bootstrap owner, create a project, open **Share**, invite the rest of the team. Without email configured, copy the invitation link the Share dialog shows after sending and send it by message.
9. Backups: open the Postgres service → **Backups** and turn on scheduled backups. Also plan to download a dump off Railway now and then (`docs/runbooks/backups.md`).

Later, optional:
- **Custom domain** (for example `writers.iduhouse.com`): **Settings → Networking → Custom Domain**, add the CNAME and TXT records it shows at your DNS provider, then change `APP_ORIGIN` to the new address.
- **Real email**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` and `MAIL_FROM` from any SMTP provider's settings page.

Every push to `main` on GitHub redeploys automatically. If a deploy fails, the **Deployments** tab shows the build and runtime logs; the lines from `pnpm --filter @writers-room/server start` are the app's own log.

## Other container hosts (Render, Fly.io)

Same shape: create a Postgres database, create a service from the repository with `deploy/Dockerfile` as the Dockerfile (build context is the repository root), expose port 3000, set the health check path to `/api/health`, set the variables from the table above, deploy. Follow the provider's docs for the exact clicks.

## Option B: your own server with Docker Compose

Requirements: a Linux VPS with Docker installed, a domain name pointing at it (A record), ports 80 and 443 open.

```bash
git clone https://github.com/idu-house-ac/writers-room.git && cd writers-room
```

```bash
cp .env.example .env
```

Edit `.env`: set `DOMAIN`, `APP_ORIGIN=https://<DOMAIN>`, a long random `SESSION_SECRET`, a `POSTGRES_PASSWORD`, the bootstrap owner, and the `SMTP_*` values if you have an email provider. Then:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Caddy fetches a certificate from Let's Encrypt on first start (DNS must already resolve). Open `https://<DOMAIN>`.

Updating to a new version:

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Logs: `docker compose -f docker-compose.prod.yml logs -f app`. Backups land in `./backups/` nightly; see `docs/runbooks/backups.md` for restore drills.

## Try it locally in production mode

To run the production build on your own machine without HTTPS (the dev Compose file remains the normal way to run locally):

```bash
docker build -f deploy/Dockerfile -t writers-room .
```

Then run the image with `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN=http://localhost:3000` and the bootstrap variables, publish port 3000, and open http://localhost:3000.
