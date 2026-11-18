# Decisions and verification notes

Kept short, newest first. Each entry says what was chosen, why, and what was checked.

## M1 (Nov 2026)

**Editor stack.** Tiptap 3.34 on ProseMirror (`@tiptap/core`, `@tiptap/react`, `@tiptap/pm`), with one node type per screenplay element (`apps/web/src/editor/elements.ts`). Verified against the installed type definitions: Tiptap 3's collaboration extension is `@tiptap/extension-collaboration` (takes `document` + `field`, or `fragment`) and depends on `@tiptap/y-tiptap` (Tiptap's fork of y-prosemirror); the cursor package is now `@tiptap/extension-collaboration-caret` (the old `-cursor` name stopped at 2.x). Both are MIT. The caret package is not used until M2.

**Document lives in Yjs from day one.** Even single-user, the script is a Y.Doc bound through the Collaboration extension (fragment `script`). Autosave sends only the update since the last acknowledged state vector to `PUT /api/projects/:id/doc`; the server applies it to the stored state with Yjs, so two tabs merge instead of overwriting. Saves are debounced 700 ms, forced at least every 4 s while typing continuously, and a keepalive save runs on `pagehide`. M2 swaps this transport for Hocuspocus without changing the document model. Undo/redo comes from the Yjs undo manager via the Collaboration extension (Tiptap's history extension is not loaded).

**Page count on the server.** On every save the server converts the Y.Doc to ProseMirror JSON (`yDocToProsemirrorJSON` from `@tiptap/y-tiptap`, no schema needed), flattens it to blocks and runs the same shared pagination engine. The dashboard reads that number. Nothing else paginates.

**Pagination engine** lives in `packages/shared/src/format/pagination.ts` with its own word-wrap (`wrap.ts`) that mirrors browser `pre-wrap` wrapping in a monospaced column: breaks at spaces (trailing spaces hang), after hyphens between letters, and hard-breaks over-long words. The page view draws page breaks, (MORE) and NAME (CONT'D) as ProseMirror decorations; CSS gets `white-space: pre-wrap; overflow-wrap: break-word; hyphens: none` so the browser agrees with the engine. A diagnostic run on a 200-page generated script showed per-block line counts identical between DOM and engine, and every page drawn at exactly 11 in. This equivalence should be re-checked whenever the font or CSS changes, and against a reference PDF in M6.

**Keyboard rules** (`commands.ts`, tested without a DOM): Enter at the end of a filled line creates the table's "Enter goes to" element; Enter on an empty line converts it in place (character/transition/scene heading/shot/centered → action, parenthetical → dialogue, dialogue → action; an empty action gets a new action line); Enter inside a line splits it keeping the element. Tab on an empty line converts in place to the "Tab goes to" element; Tab after a filled line adds that element below (a filled character cue gets a parenthetical). New parentheticals come with brackets and the cursor between them, and Enter or ")" before the auto-closed bracket behaves as at the end of the line. Mod+1..8 set the element in table order; Shift+Tab steps back.

**Upper-case elements** (scene heading, character, transition, shot) are stored upper-case: a plugin upper-cases text as it is typed or pasted, so exports and name matching see one spelling. Parentheticals are not forced to lower case (proper nouns).

**Profiles.** Every number (indents, widths, blank lines, page geometry, keep-with-next, split rules) is in `packages/shared/src/format/feature.ts`. `pageStyles.ts` turns the profile into CSS at runtime; `editor.css` contains no inches. TV profiles map to the feature profile until M7.

**Measured on a 200-page generated script** (Chromium, this container): open 1.0 s; keystroke to painted frame median 16 ms, p90 24 ms; page count in the status bar updates about 140 ms after the keystroke that changes it (120 ms recompute debounce); pagination of 3,400 blocks takes well under 200 ms (unit test). Targets from the brief (no visible lag, page count within ~0.5 s) are met with room to spare.

**Not in M1, by design.** Presence and the "is writing" badge (M2), comments (M3), history (M4), index cards (M5), export/import and title page (M6), TV profiles (M7). Scene numbers in the margins are a later-phase option. Pasted content keeps its element types when it comes from Writers Room; plain text pastes as action lines.

**Dev hooks.** In development builds the page exposes `window.__wrDoc` (the autosave handle) and `window.__wrPagination` (the engine result) for diagnostics. They are stripped from production builds by the `import.meta.env.DEV` guard.

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
