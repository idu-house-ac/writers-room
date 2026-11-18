# Decisions and verification notes

Kept short, newest first. Each entry says what was chosen, why, and what was checked.

## M0 (Nov 2026)

**Package versions.** Checked against the npm registry on 2026-11-18. Chosen: Fastify 5.12, pg 8.23, Nodemailer 10.6 (MIT-0), zod 4.6, React 19.3, React Router 7.18, Vite 7.3, Vitest 4.1, TypeScript 5.9. Newer majors exist that were *not* adopted because their API changes were not verified in this session: TypeScript 7.0 (the native compiler port), Vite 8.3, Vitest 5.1, React Router 8.5, @vitejs/plugin-react 6.3. These are worth a deliberate upgrade pass later, one at a time, with the test suite as the gate. All dependencies are MIT, Apache-2.0, MIT-0 or OFL-1.1.

**Zod 4.** `z.email()` and `z.url()` are used instead of the deprecated `z.string().email()` / `.url()` chain.

**Passwords.** Hashed with Node's built-in `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key). No native dependency to build in Docker. Format is self-describing so parameters can be raised later without breaking old hashes.

**Sessions.** Random 256-bit id stored in a `sessions` table, sent in a signed, httpOnly, SameSite=Lax cookie (`wr_session`), 30-day sliding expiry. Password reset signs out every other session of that user.

**CSRF.** SameSite=Lax cookies plus an Origin check on every state-changing request: a request that carries an `Origin` header must match `APP_ORIGIN` (or the server's own origin). In development the browser only ever talks to Vite, which proxies `/api` to the server, so everything is same-origin and no CORS is needed. The CORS plugin is registered for `APP_ORIGIN` only, for the case where the web app is served from another origin.

**Tokens in links.** Invite and password-reset tokens are 256-bit random strings; only their SHA-256 is stored (`token_hash`), so a database read does not yield usable links. The brief's `invites.token` column is therefore `token_hash`.

**Invites.** One pending invite per email per project: re-inviting the same address refreshes the link, updates the role and resends. Accepting a link once marks it used. Expiry 7 days. A project can never be left without an Owner (the server refuses the last Owner's demotion or removal).

**First account.** Accounts are invite-only, so the first Owner is created from `BOOTSTRAP_OWNER_*` environment variables on server start (idempotent). A small CLI (`pnpm cli create-user | set-password | list-users`) covers the rest.

**Mail.** One module (`apps/server/src/mail.ts`) wraps Nodemailer; `smtp` when `SMTP_HOST` is set, `console` otherwise (prints the email to the server log), `memory` in tests. Docker Compose ships Mailpit as the dev catcher. Provider for production is an open question in BRIEF.md.

**Backups.** Plain `pg_dump` in a loop inside a `postgres:16-alpine` container, nightly plus on start, with a restore script. Chosen over a third-party backup image to keep the dependency list short and the scripts readable. Verified locally: a dump of the M0 schema restored into a fresh database with identical row counts.

**Docker Compose in development.** Source is bind-mounted for live reload; `node_modules` folders are anonymous volumes seeded from the image, so `docker compose build` is needed after a dependency change. A production compose file with Caddy and a built web app is M7.

**Page count on the dashboard.** `pageCount` is `null` until a project has a script (M1); the card shows "No script yet". The live "is writing" badge needs presence and arrives with M2.

**Duplicate project.** Copies the project record and makes the caller its Owner; other members are not copied. Copying the document itself is added when the document exists (M1/M2).
