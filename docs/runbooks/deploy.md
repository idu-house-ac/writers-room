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

## Option B: your own server with Docker Compose, step by step

The cheapest reliable setup. Written for Hetzner Cloud; DigitalOcean or Linode work the same way with different buttons. Prices quoted are approximate and change; check the provider's pricing page.

### 1. Rent the server (about 10 minutes)

1. Create an account at hetzner.com (Cloud). New accounts may be asked for ID verification.
2. In the Cloud Console: **New project**, then **Servers → Add server**.
   - **Location**: the one closest to the team (Hetzner has Germany, Finland, the US and Singapore).
   - **Image**: Ubuntu, newest LTS.
   - **Type**: the smallest **shared vCPU** plan with at least 2 GB of memory (for example CX23 or CPX12/CPX22, whichever is orderable in that location). Roughly 4 to 12 EUR a month depending on plan and location.
   - **SSH key**: add your Mac's public key. If you do not have one, run `ssh-keygen -t ed25519` in Terminal and paste the contents of `~/.ssh/id_ed25519.pub`. Without a key you get a root password by email instead, which also works.
   - **Firewall**: create one that allows inbound TCP 22, 80 and 443 and attach it.
   - **Backups**: enable. This adds about 20% to the price and gives daily snapshots of the whole disk, which is the simplest off-box backup.
3. Note the server's public IP address.

### 2. Point a domain at it

At your DNS provider (wherever iduhouse.com is managed), add an **A record**: name `writers` (so the address becomes `writers.iduhouse.com`), value the server IP. Wait until `ping writers.iduhouse.com` from your Mac answers with that IP; this can take a few minutes to an hour.

### 3. Prepare the server (about 10 minutes, once)

Connect:

```bash
ssh root@YOUR.SERVER.IP
```

Install updates and Docker:

```bash
apt update && apt -y upgrade && curl -fsSL https://get.docker.com | sh
```

Give the server read access to the private GitHub repository with a deploy key:

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```

Copy the printed line. On GitHub open the repository → **Settings → Deploy keys → Add deploy key**, paste it, leave "Allow write access" unchecked, save. Then:

```bash
git clone git@github.com:idu-house-ac/writers-room.git && cd writers-room
```

Answer `yes` when asked about GitHub's host key.

### 4. Configure and start

```bash
cp .env.example .env && nano .env
```

Set these lines (Ctrl+O saves, Ctrl+X leaves nano):

```
DOMAIN=writers.iduhouse.com
APP_ORIGIN=https://writers.iduhouse.com
SESSION_SECRET=<output of: openssl rand -hex 32>
POSTGRES_PASSWORD=<output of: openssl rand -hex 16>
BOOTSTRAP_OWNER_EMAIL=you@example.com
BOOTSTRAP_OWNER_NAME=Your Name
BOOTSTRAP_OWNER_PASSWORD=<a strong password>
```

Leave the `SMTP_*` lines empty for now; invitations work through the link the Share dialog shows. Then:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first start takes a few minutes. Watch it with:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

When you see `Server listening`, open `https://writers.iduhouse.com`. Caddy fetched the certificate automatically. Sign in with the bootstrap owner, create a project, click **Share**, invite the team.

### 5. Keep it running

- **Update** after new code lands on `main`:
  ```bash
  cd ~/writers-room && git pull && docker compose -f docker-compose.prod.yml up -d --build
  ```
  Watch the end of the output: if the build fails, Docker keeps the previous version running and the last lines say so in red. The GitHub Actions check on the repository (the tick or cross next to the latest commit) shows whether a version builds before you pull it.
- **System updates** once a month: `apt update && apt -y upgrade`, then `reboot` if it says a restart is needed. Everything comes back on its own.
- **Backups**: Hetzner's daily server backups cover the whole machine. The app also writes a nightly database dump to `~/writers-room/backups/`. Once a month, run the restore drill in `docs/runbooks/backups.md`, and copy a recent dump to your Mac:
  ```bash
  scp root@YOUR.SERVER.IP:~/writers-room/backups/writers-room-*.dump ~/Downloads/
  ```
- **Disk space**: `df -h /` should stay under 80%. Old Docker images can be cleaned with `docker image prune -f`.
- **Email later**: fill in the `SMTP_*` lines in `.env` and run the update command; the server restarts with email enabled.

## Try it locally in production mode

To run the production build on your own machine without HTTPS (the dev Compose file remains the normal way to run locally):

```bash
docker build -f deploy/Dockerfile -t writers-room .
```

Then run the image with `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN=http://localhost:3000` and the bootstrap variables, publish port 3000, and open http://localhost:3000.
