# Decisions and verification notes

Kept short, newest first. Each entry says what was chosen, why, and what was checked.

## M4 (Nov 2026)

**Snapshots are full copies.** Each row in `snapshots` holds the complete Yjs state (`crdt_snapshot`) and the ProseMirror JSON of the script (`content`), plus a content hash and page count. Yjs's built-in snapshot feature is not used: as the brief suspected, it needs garbage collection off, which would make the live document grow without bound (confirmed against the Yjs source: `createAbsolutePositionFromRelativePosition` returns null for garbage-collected structs, so GC stays on). Nothing is ever pruned.

**Automatic snapshots** come from the collaboration server: `onChange` records who edited; a timer takes a snapshot of any document edited in the last 10 minutes (`snapshotIntervalMs`, 300 ms in tests); `onDisconnect` with no clients left takes one immediately. A snapshot whose content hash equals the latest one is skipped. Named drafts and "before restore" copies come from the API.

**Restore applies a diff, not a replacement.** The restore route opens a Hocuspocus direct connection and, inside one transaction, aligns the current blocks with the snapshot's by longest common subsequence and deletes or inserts only the blocks that differ. Everyone connected receives it as an ordinary edit; the stored document is written straight after (not left to the store debounce). Unchanged blocks keep their Yjs items, so comments on them keep their anchors; comments whose anchors now point at deleted or garbage-collected items are set to `detached` and stay in the panel, never deleted. A "before restore" snapshot is taken first. The notice ("Amadin restored Draft 2") travels as a stateless broadcast and shows as a toast in every open editor.

**Two gotchas found by tests.** Postgres `jsonb` reorders object keys, so block comparison uses a canonical key (type, text, sorted marks) instead of `JSON.stringify` of the stored JSON. Node's pooled `Buffer.from(base64)` returns a view with a non-zero byte offset, which the Yjs decoder cannot read; anchors are copied into a fresh `Uint8Array` first.

**Compare** runs in the browser (`apps/web/src/history/diff.ts`): block-level LCS, then word-level LCS inside replaced blocks, rendered inline (one column) or side by side. Added text is underlined and green, removed text struck through and red, so colour is never the only signal.

**Verified with two browsers:** restoring a draft dated an hour earlier showed the restored text and the notice in both; the pre-restore copy appeared in history; a comment on removed text showed as detached.

## M3 (Nov 2026)

**Anchors.** A thread stores two Yjs relative positions (base64) made with `absolutePositionToRelativePosition` from the Tiptap binding, so they follow the characters through any edit by anyone. The client resolves them against the live document on every change. A range that resolves to nothing, or collapses to zero width, shows as "no longer in the script"; M4 will also set the stored status to `detached` on restore. Verified in two browsers: 20 lines inserted above a comment left the highlight on exactly the same words.

**Plugin ordering gotcha.** ProseMirror builds plugin states in plugin order, and the comment-highlight plugin runs before the Yjs sync plugin, so during a transaction the sync state is not on the new state yet. Highlights are therefore mapped through each transaction (`DecorationSet.map`) and re-resolved from the anchors 50 ms after the document settles, with the sync state read from the previous state when the new one lacks it. The same ordering is why the sync plugin is looked up by its registered name (`editor/ysync.ts`) rather than by key object.

**Vite dedupe.** In development Vite had optimised two copies of `@tiptap/y-tiptap`, so plugin keys and class checks did not match between app code and the collaboration extension. `optimizeDeps.include` and `resolve.dedupe` in `vite.config.ts` pin Yjs, the binding and ProseMirror to one copy. Production builds were never affected.

**Live updates.** Comment changes are broadcast to everyone on the document through Hocuspocus stateless messages (`document.broadcastStateless`) from the API route, with a 30 s poll as fallback. Notifications poll every 20 s.

**Mentions.** Bodies are plain text containing `@Name`; the `mentions` column holds the member ids chosen from the picker. The server drops ids that are not project members. Mentioned members get a `mention` notification; other participants of the thread get `reply`; a member invited to a project gets `invite`. Email notifications are a later phase as the brief says.

**Permissions.** `test/comments.test.ts` runs the whole permissions table against the API, and connects a Commenter to the collaboration server to confirm their edits are dropped (read-only connection) and never stored. Readers get 403 on comments. Authors edit and delete their own comments; Owners may delete anyone's; a thread with no comments left is removed.

## Deployment prep (Nov 2026, after M2)

**One process, one port.** The collaboration WebSocket now mounts on the API's own port at `/collab` through `@fastify/websocket` (MIT), instead of a second port. Hocuspocus 4's `handleConnection` expects a Fetch-style `Request` and does not attach socket listeners itself (its bundled `Server` uses `crossws` for that), so `app.ts` rebuilds a `Request` from the upgrade headers (cookie included, hop-by-hop headers dropped) and forwards `message`, `close` and `pong` events to the connection. This matters for hosts that expose a single port (Railway, Render, Fly.io) and simplifies Caddy.

**Production image.** `deploy/Dockerfile` builds the web app and runs the server with `WEB_DIST` set, so the server serves the static files with an index.html fallback for client routes. The server still runs through `tsx` (no compile step); dev dependencies are therefore installed in the image. Acceptable for a small team; a compiled build can come later if image size matters. `docker-compose.prod.yml` adds Caddy for automatic HTTPS and the backup service. Verified locally by running the image's command (not the image itself, since Docker is not available in the build environment) with a built web bundle: the full two-browser collaboration test passes against the single port.

**Hosting choice.** Vercel cannot run the server (no long-lived processes or WebSockets), so the runbook recommends a container host or a VPS. See `docs/runbooks/deploy.md`.

**Invitation links without email.** Invite creation and resend now return the link to the Owner, and the Share dialog shows it with a Copy button. Tokens are still only stored hashed; the link is shown once, at creation.

**Autocomplete and Tab.** Suggestions appear after the first typed character (never on an empty cue), Tab fills the name and moves on to a parenthetical, Enter fills it and moves to dialogue, and Tab on an empty line always cycles elements.

## M2 (Nov 2026)

**Collaboration server.** Hocuspocus 4.8 (`@hocuspocus/server`, MIT) runs inside the API process on its own port (`COLLAB_PORT`, default 3001); the web app reaches it at `/collab` (Vite proxies it in development; Caddy will in M7). Verified against the installed types: the entry point is the `Server` class (`listen`, `destroy`, `.hocuspocus` for documents and connection counts). `listen(0)` does not pick a random port, it falls back to the default, so tests choose a port explicitly.

**Authentication over the cookie.** The browser's WebSocket upgrade carries the session cookie, so `onAuthenticate` unsigns it with `@fastify/cookie`'s `Signer`, loads the session and looks up the membership. Non-members and signed-out sockets are refused; Commenters and Readers get `connectionConfig.readOnly = true`, which makes the server drop their document updates (verified by test: a reader's edit never reaches another client or the database). The provider's `token` is a fixed placeholder, only there to make the client run the authentication step.

**Provider quirk.** A `HocuspocusProvider` given an external `websocketProvider` must call `attach()` itself; one constructed with a `url` attaches automatically. Also, the reconnect helper rejects a `delay` below `minDelay` (1000 ms) and then never connects, silently. Both cost an hour; the tests document them.

**Persistence.** The same `project_docs` table as M1: `onLoadDocument` applies the stored state, `onStoreDocument` (debounced 2 s, at most 10 s) writes the full state back, recomputes the page count with the shared engine and stamps the project's last editor from the connection context. The M1 REST `PUT /doc` route stays for imports and tests.

**Offline.** `y-indexeddb` caches the document per project in the browser; edits made offline are kept across tab closes and merge when the socket returns. The status bar shows "Offline, changes saved locally" from the provider's connection state plus `navigator.onLine`. Verified in a two-browser run: a tab taken offline, edited, closed, brought back online and reopened merged its edit with a concurrent online edit, both documents identical.

**Presence.** `@tiptap/extension-collaboration-caret` publishes each user's caret as awareness state and draws named carets. The scene navigator shows a coloured dot per collaborator in each scene (relative cursor positions resolved through the sync plugin's mapping). Click an avatar to follow that person: the view scrolls to their caret on every update until you scroll or type. The dashboard's "is writing" badge comes from `GET /api/presence`, which reads awareness states of the loaded documents, polled every 10 s.

**Fresh document edge.** When a brand-new empty script is opened by two people who both start typing before either has synced a first block, each browser's initial empty line becomes its own block, so the document may begin with two action lines. Harmless and easy to delete; noted so nobody hunts for it.

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
