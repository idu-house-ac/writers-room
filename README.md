# Writers Room

Private, self-hosted screenwriting for the Idu House team: live co-writing, comments, version history and an index-card board. The product brief is in [BRIEF.md](BRIEF.md); build notes are in [docs/decisions.md](docs/decisions.md).

**Status: milestone M2 (live co-writing).** Accounts, invitations, roles, dashboard and backups (M0); the screenplay editor with the feature format, smart typing, page view, navigator, find and replace, themes and autosave (M1); and now several people editing the same script at once with named carets, presence avatars, follow mode, offline editing that merges on reconnect, and an "is writing" badge on the dashboard. Comments arrive in M3.

## Run it

Requirements: Docker with Compose.

```bash
cp .env.example .env
```

Edit `.env`: set `SESSION_SECRET` to a long random string and choose the first Owner's email, name and password (`BOOTSTRAP_OWNER_*`). Then:

```bash
docker compose up --build
```

| What | Where |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000/api/health |
| Collaboration server (WebSocket) | port 3001, reached by the app at `/collab` |
| Mailpit (every email the app sends) | http://localhost:8025 |
| Nightly database dumps | `./backups/` |

Sign in with the bootstrap Owner. Create a project, open it, click **Share**, invite a second email address with a role. Open Mailpit, click the invitation link, create the second account, and it will see only the projects it belongs to. **Forgot your password?** on the sign-in page sends a reset link to Mailpit as well.

Backups and restore drills: [docs/runbooks/backups.md](docs/runbooks/backups.md).

## Develop without Docker

Requirements: Node 22+, pnpm 10, a Postgres 16 database.

```bash
pnpm install
```

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/writers_room \
SESSION_SECRET=some-long-random-string \
BOOTSTRAP_OWNER_EMAIL=you@example.com BOOTSTRAP_OWNER_PASSWORD=change-me-please \
pnpm dev
```

Without `SMTP_HOST`, emails are printed to the server log instead of sent. The web app runs on port 5173 and proxies `/api` to the server on port 3000.

Tests (the server tests need a database; default `postgres://postgres@127.0.0.1:5433/writers_room_test`, override with `TEST_DATABASE_URL`):

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Writing

Open a project and type. The editor follows the usual screenwriting flow:

- Start a line with `INT.` or `EXT.` for a scene heading. A line in capitals ending in `TO:` becomes a transition.
- **Enter** moves to the next element (scene heading → action, character → dialogue, dialogue → action...). **Tab** switches (action → character, dialogue → parenthetical, empty character → action). Enter on an empty line turns it back into action.
- **Ctrl/Cmd+1..8** set the element directly: scene heading, action, character, parenthetical, dialogue, transition, shot, centered.
- Character names, locations and times of day are suggested from the script as you type; Enter accepts and moves on, Tab accepts, Esc hides.
- **Ctrl/Cmd+F** finds and replaces. The Characters tab renames a character everywhere.
- **Tab** on an empty line cycles through all eight elements in that order; Shift+Tab cycles back.
- Page view shows pages as they will print, with (MORE) and (CONT'D) on split dialogue. Draft view hides page breaks.
- Everyone in the project can type at the same time. Avatars in the header show who is here; click one to follow their cursor. If your connection drops, keep writing: the status bar says "Offline, changes saved locally" and your edits merge when it returns.

## Layout

```
apps/server     Fastify API: auth, projects, members, invites, mail
apps/web        React + Vite front end
packages/shared Types and the permissions table shared by both
deploy/         Dockerfile and backup scripts
docs/           Brief, mockups, decisions, runbooks
```

## Roles

| Action | Owner | Writer | Commenter | Reader |
|---|---|---|---|---|
| Read, export | Yes | Yes | Yes | Yes |
| Comment | Yes | Yes | Yes | No |
| Edit script, cards, title page, notes | Yes | Yes | No | No |
| Name drafts, restore versions, duplicate | Yes | Yes | No | No |
| Invite, remove, change roles | Yes | No | No | No |
| Archive | Yes | No | No | No |

The server enforces every row; the UI only hides what a role cannot do. There are no project caps, seat limits or paid tiers anywhere in the code.
