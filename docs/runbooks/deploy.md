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

## Option A: a container host (Railway, Render, Fly.io)

The exact clicks differ per provider and change over time, so treat this as the shape of the setup and follow the provider's own docs for the details.

1. Create a Postgres database on the provider and note its connection URL.
2. Create a service from this GitHub repository. Point it at `deploy/Dockerfile` (the Docker build context is the repository root). Expose port 3000 and set the health check path to `/api/health`.
3. Set the environment variables from the table above. `APP_ORIGIN` is the public URL the provider gives you (or your custom domain, once attached).
4. Deploy. Sign in with the bootstrap owner, create a project, open Share, invite the rest of the team.
5. Backups: use the provider's database backup feature, or run `deploy/backup/backup.sh` from a scheduled job that has `pg_dump` and the `PG*` variables (see `docs/runbooks/backups.md`). Make sure the dump is copied off the provider.

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
