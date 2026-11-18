# Writers Room — Build Brief for Claude Code

Nov 17, 2026 · Idu House

## Overview

Build a private, browser-based screenwriting app for the Idu House team with live co-writing, comments, version history and an index-card board. It covers the writing side of what Celtx offers, with no project caps, seat limits or locked features.

**Name:** Writers Room. The app must not use the Celtx name, logo, wording or visual design. Similar features are fine; copied branding is not.

**Users:** Amadin, Aaron and invited collaborators. Invite-only, no public sign-up.

**Formats on day one:** feature screenplay, single-camera TV, multi-camera TV.

### In v1

- Projects with members and roles
- Screenplay editor with automatic formatting and smart typing
- Live co-writing with presence (who is here, where their cursor is)
- Comments with threads, @mentions and resolve
- Version history: automatic snapshots, named drafts, compare, restore
- Index-card board linked to scenes
- Title page and a notes page per project; PDF, Fountain, Final Draft (.fdx) and plain-text export; Fountain and .fdx import

### Not in v1 (later phases)

Script breakdown and tagging, shot lists, storyboards, scheduling, call sheets, budgeting, colored production revisions, mobile apps, stage play and other formats, dual dialogue (imported dual dialogue becomes back-to-back dialogue and is listed in the import summary), AI features.

**No paywall rules:** no limits on projects, collaborators, history length or export formats anywhere in the code. No plan or billing concepts in the data model.

## How to hand this to Claude Code

1. Export this doc as Markdown and save it as `BRIEF.md` at the root of a new, empty project folder.
2. Save screenshots of each mockup screen into `docs/mockup/` in that folder, plus a screenshot of the architecture diagram in the Tech stack section (it may not survive the Markdown export).
3. Open Claude Code in that folder and start with: "Read BRIEF.md and the images in docs/mockup. Build milestone M0 only, run it, then stop and tell me how to try it."
4. Review each milestone before asking for the next one.

### Working rules for Claude Code (also in CLAUDE.md)

- Work one milestone at a time. Stop at each milestone's acceptance criteria and report.
- Library names, versions and APIs in this brief are a starting point, not verified facts. Check each package's current documentation before using it, and say when something here is out of date.
- Use only open-source dependencies under permissive licenses (MIT, Apache-2.0, BSD, ISC, SIL OFL for fonts). Flag anything else before adding it.
- Write automated tests for formatting, smart-type transitions and pagination. These are where screenwriting apps break.
- Never add usage limits, plan tiers, upgrade prompts or feature flags tied to payment.
- Keep everything runnable on one machine with a single command (Docker Compose) so the team can self-host.

## Tech stack and architecture

A TypeScript web app on a ProseMirror-based editor, synced live through Yjs (a CRDT library that merges simultaneous edits without conflicts) and a self-hosted Hocuspocus server, with Postgres for everything else. All open source, all self-hostable on one small server.

The collaboration server asks the API whether a connecting user may read or edit that project before it syncs anything; Commenters and Readers get a read-only connection.

| Layer | Starting choice | Why | Verify before use |
|---|---|---|---|
| Web app | React + TypeScript + Vite | Common, well documented, fast dev loop | current major versions |
| Editor | Tiptap (on ProseMirror) with one custom node type per screenplay element | Structured documents, keyboard control, official Yjs binding | Tiptap's collaboration and collaboration-cursor/caret package names, which have changed between majors |
| Live sync | Yjs + @tiptap/extension-collaboration + @hocuspocus/provider | Conflict-free merging, offline support, presence ("awareness") built in | APIs against Tiptap's collaborative editing guide |
| Offline cache | y-indexeddb in the browser | Keeps unsynced edits across reloads | package still maintained |
| Collaboration server | Hocuspocus (MIT, self-hosted) with its database extension | Auth hooks per connection, persistence, snapshots | current major (4.x as of 2026) and its auth hook names |
| API server | Node + Fastify (or Hono), same repo | Auth, projects, comments, history, export | none |
| Database | Postgres 16+ | Relational data plus binary CRDT state | none |
| Auth | Email + password with invite links; sessions in httpOnly cookies | Small private team; needs only our server plus the email service below | see Open questions (Google sign-in) |
| PDF export | Server-side, from the shared pagination engine, drawn with pdf-lib or PDFKit | Identical page breaks to the on-screen page view | which library handles embedded TrueType fonts best |
| Font | Courier Prime (SIL Open Font License) | Free to bundle; designed for screenplays | include its license file |
| Fountain | fountain-js for import, own writer for export | Open plain-text screenplay format | how well it handles dual dialogue and notes |
| Final Draft (.fdx) | Own XML reader and writer | No official public spec; build from sample files | test against files exported by Final Draft |
| Hosting | Docker Compose on one VPS, HTTPS via Caddy | One command to run; easy backups | none |

Also needed: an email-sending service for invites, password resets and (later) notifications. Any standard SMTP provider or transactional email API works; use Nodemailer or the provider's SDK, and keep the provider behind one small module so it can be swapped. In local development, catch outgoing mail with a dev mail catcher (for example Mailpit) instead of sending it. See Open questions for the provider choice.

**One rule above all:** the pagination engine is a single shared module used by the page view, the PDF export and the page count. If two things paginate separately, they will disagree.

## Screenplay formatting spec

Every format is a **format profile**: a config object of page geometry and per-element rules. Never hard-code indents in CSS or the PDF engine; read them from the profile so a show-specific style can be added later without code changes.

**Page (all three profiles):** US Letter (8.5 × 11 in), 12 pt Courier-family monospaced font (10 characters per inch, 6 lines per inch), left margin 1.5 in, right, top and bottom about 1 in. Page number top right, followed by a period ("23."), none on page 1. Use Courier Prime, which is free to bundle; verify its license before shipping.

### Feature screenplay profile

Indents are measured from the left edge of the page. Published guides disagree by a few tenths of an inch (character cue ranges from about 3.5 to 4.25 in), so treat these as defaults to check against a reference script.

| Element | Left edge (in) | Approx. width (in) | Case | Blank lines before | Enter goes to | Tab goes to |
|---|---|---|---|---|---|---|
| Scene heading | 1.5 | 6.0 | UPPER | 1 (option: 2) | Action | Action |
| Action | 1.5 | 6.0 | As typed | 1 | Action | Character |
| Character | 3.7 | 3.0 | UPPER | 1 | Dialogue | Action (if empty) |
| Parenthetical | 3.1 | 2.0 | lower, in ( ) | 0 | Dialogue | Dialogue |
| Dialogue | 2.5 | 3.5 | As typed | 0 | Action | Parenthetical |
| Transition | right-aligned to 7.5 | 2.0 | UPPER, ends in ":" | 1 | Scene heading | Scene heading |
| Shot | 1.5 | 6.0 | UPPER | 1 | Action | Action |
| Centered text | centered | 6.0 | As typed | 1 | Action | Action |

### Smart typing

- Typing INT., EXT., INT./EXT. or I/E at the start of a line converts it to a scene heading.
- Typing ( at the start of a line inside a dialogue block converts it to a parenthetical.
- A line in all caps ending in TO: converts to a transition.
- Autocomplete from the script itself: character names on Character lines; locations and times of day (DAY, NIGHT, CONTINUOUS, LATER) on scene headings; extensions (V.O.), (O.S.), (CONT'D).
- Shortcut keys switch the current line's element: Cmd/Ctrl+1 through 8 in the table's order.

### Pagination rules (PDF export and on-screen page view must use the same engine)

- Never end a page with a scene heading, a character cue or a parenthetical.
- Dialogue that splits across pages breaks at a sentence boundary, with (MORE) under it and CHARACTER (CONT'D) at the top of the next page.
- Transitions stay with the content above them.
- Optional scene numbers in both margins, which can be locked once the script goes to production (later phase).

### Single-camera TV profile

Same geometry as the feature profile, plus Act/Teaser/Cold Open/Tag headings (centered, caps, underlined), "END OF ACT ONE" lines, and a page break before each act.

### Multi-camera TV profile

Shows vary, so make each rule a profile setting. Defaults from published guides: action and description in all caps; scene headings underlined; dialogue double-spaced; scenes lettered (SCENE A, SCENE B), not numbered; the characters in each scene listed in parentheses under its heading; sound effects and character entrances/exits underlined; acts end with a centered "END OF ACT ONE". Expect page counts roughly double a single-camera script of the same length.

Formatting sources: Quote-Unquote Apps format guide, Screenplay.com basic format, Final Draft on multi-cam vs single-cam, WriterDuet multi-cam template.

## Feature requirements

### Accounts and projects

- Invite-only accounts. An Owner invites people by email with a role: Owner (everything), Writer (edit + comment), Commenter (comment only), Reader (view and export).
- Projects dashboard: cards per project with title, format, page count, last edited by whom and when, and member avatars. Search and sort by recent.
- Each project holds one script, a title page, an index-card board and a notes page. Duplicate a project; archive a project.

**Who can do what.** The server enforces every row; the UI only hides what a role can't do.

| Action | Owner | Writer | Commenter | Reader |
|---|---|---|---|---|
| Read the script, cards, notes | Yes | Yes | Yes | Yes |
| Export | Yes | Yes | Yes | Yes |
| Comment and reply | Yes | Yes | Yes | No |
| Edit script, cards, title page, notes | Yes | Yes | No | No |
| Name a draft | Yes | Yes | No | No |
| Restore a version | Yes | Yes | No | No |
| Duplicate the project | Yes | Yes | No | No |
| Invite, remove, change roles | Yes | No | No | No |
| Archive the project | Yes | No | No | No |

### Script editor

- Page view (paper pages with breaks, as printed) and a continuous "draft" view with no page breaks. Only page view uses the pagination engine.
- Left sidebar: scene navigator (scene number, heading, page) with click-to-jump and drag to reorder scenes; a Characters tab and a Locations tab built automatically from the script.
- Element picker in the toolbar showing the current line's element.
- Find and replace, including "rename character everywhere".
- Live page count, scene count and estimated runtime (1 page ≈ 1 minute; label it as an estimate).
- Focus mode (hides chrome), light and dark themes, zoom.
- Autosave continuously; no save button.

### Live co-writing

- Several people edit the same script at once with no locking and no lost text.
- Presence: avatars of who is in the project; each collaborator's cursor and selection in their colour, labelled with their name.
- Click an avatar to jump to and follow that person's cursor.
- Offline edits are kept in the browser and merge when the connection returns. Show a clear "offline, changes saved locally" state.

### Comments

- Select text, add a comment. The comment stays attached to that text when lines above it change.
- Threads with replies, @mentions of project members, resolve and reopen, filter by open/resolved/mine.
- Comment highlights in the script; a comments panel on the right.
- In-app notification on mention or reply. Email notifications are a later phase.
- Readers cannot comment; Commenters cannot edit script text.

### Version history

- Automatic snapshot at least every 10 minutes of active editing and when the last person leaves.
- Store each snapshot as a full copy of the document state. Don't rely on Yjs's built-in snapshot feature: as far as we know it only works with the document's garbage collection turned off, which makes the live document grow forever. Verify against current Yjs docs.
- Named drafts ("Draft 2 – table read") created by Owners and Writers.
- History panel: list of snapshots with author(s) and time; preview any snapshot read-only; compare any two with additions and deletions highlighted.
- Restoring: save a "before restore" snapshot of the current state first. Then apply the old version to the live script as one ordinary edit, so everyone connected receives it. Never overwrite the saved document underneath connected users: their browsers would sync the current text straight back. Everyone in the project sees a notice ("Amadin restored Draft 2").
- Comments whose text a restore removes become detached: kept in the panel with their quoted text and marked "no longer in the script". Never delete them.
- Unlimited history retention.

### Index-card board

- One card per scene, generated from the scene headings, showing heading, a short synopsis field and a colour.
- Cards laid out in columns by act (feature: user-defined acts; TV: Cold Open, Act One, …, Tag).
- Dragging a card to a new position moves that scene in the script, and moving a scene in the script moves its card.
- Moving a scene safely: live-sync libraries generally treat a move as delete plus re-insert, which can lose or duplicate a collaborator's typing in that scene. So a move takes a short lock on the scene. If someone has typed in it within the last few seconds, the card shows "Waiting for Aaron to pause" and moves when they do; nobody can type in the scene during the move itself. First check whether the current Yjs version supports a native move; if it does, prefer that.
- "Loose" cards for beats not yet written; turning a loose card into a scene inserts a scene heading at that position.
- Live for all collaborators, same as the script.

### Title page

- Fields: title, written by, based on, draft name and date, contact block. Laid out in the standard positions on export.

### Import and export

- Export: PDF (matches the page view exactly), Fountain (.fountain), Final Draft (.fdx), plain text.
- Import: Fountain and .fdx into a new project. Show a summary of anything the importer couldn't map.
- Export options: include/exclude title page, scene numbers, watermark text (for example a reader's name).

## Data model

Live content (script text, title page, cards, notes) lives in one shared CRDT document per project, saved to the database as binary. Everything about who can do what, plus comments and history, lives in ordinary tables.

| Table | Key fields | Notes |
|---|---|---|
| users | id, email, name, avatar_url, colour, created_at | colour = presence/cursor colour |
| invites | id, email, project_id, role, token, expires_at, accepted_at | single-use link |
| projects | id, title, format_profile, created_by, archived_at, updated_at | format_profile: feature, tv_single, tv_multi |
| project_members | project_id, user_id, role | role: owner, writer, commenter, reader |
| project_docs | project_id, crdt_state (binary), updated_at | the live shared document |
| snapshots | id, project_id, crdt_snapshot (binary), name (nullable), authors[], created_at, kind | full copy of the document state; kind: auto, named or pre_restore |
| comment_threads | id, project_id, anchor_start, anchor_end, quoted_text, status, created_by | anchors are CRDT relative positions, so they follow edits; status: open, resolved or detached |
| comments | id, thread_id, author_id, body, mentions[], created_at, edited_at | |
| notifications | id, user_id, type, payload, read_at | mention, reply, invite |

Inside the shared document: `script` (ordered blocks, each with element type and text), `titlePage` (map of fields), `cards` (map of card id → scene link or loose, synopsis, colour, act, order), `acts` (ordered list), `notes` (rich text for the project's notes page).

## Screens

The Writers Room app mockup shows the five v1 screens. Treat it as layout and behaviour guidance, not pixel spec; project titles, script text and numbers in it are sample content.

| Screen | What it must show | Notes for the build |
|---|---|---|
| 1 · Projects dashboard | Project cards with title-page thumbnail, format, draft, page count, last editor, live "is writing" badge; filters by format; import and new project | Only projects the user is a member of. No project counts or limits anywhere. |
| 2 · Script editor | Element picker, page/draft view, scene navigator with presence dots, paper page with live collaborator caret and name, comment highlights, comments panel, save/sync status, page count and runtime estimate | The hero screen; M1–M3 build it up in layers. Page geometry from the format profile. |
| 3 · Index-card board | Act columns, cards with scene number, heading, synopsis, storyline colour; a collaborator dragging a card live; loose cards with "Turn into scene" | Storyline colours are labels, so colour is never the only signal. M5. |
| 4 · Version history | Named drafts and automatic versions; compare any two inline or side by side; added vs removed shown by underline and strikethrough as well as colour; restore as new version | M4. Restore never deletes anything. |
| 5 · Share and roles | Invite by email with a role, role explanations, member list with role changes, pending invites with resend and revoke | Server enforces roles; UI only reflects them. M0 + M3. |

**Visual direction:** neutral dark chrome (#121110 ground), one gold accent (#E0B04A) for primary actions and focus, Inter for UI, Space Grotesk for headings, Courier Prime on the page. Each collaborator gets a fixed presence colour. Swap in Idu House brand tokens later if wanted.

## Milestones

Build in this order. Each milestone ends with a working app, not a pile of parts. No dates are set; agree pacing after M0.

1. **M0 – Skeleton.** Repo, Docker Compose (web, server, database, dev mail catcher), sign-in, password reset, invites by email, roles, projects dashboard, nightly database backups.
   - Done when: one command starts everything; an Owner invites a second account by email, which signs in and sees only the projects it belongs to; a password reset works; last night's backup restores into a fresh database.
2. **M1 – Single-user editor.** Feature profile, all elements, smart typing, scene navigator, page view, autosave.
   - Done when: a writer can type a 10-page scene sequence using only Enter, Tab and typing, and every line lands in the right element. Tests cover every Enter/Tab transition in the table. On a 120-page test script, typing shows no visible lag and the page count updates within about half a second (starting targets; adjust after measuring).
3. **M2 – Live co-writing.** Shared document, presence, cursors, follow mode, offline merge.
   - Done when: two browsers typing in the same paragraph at once both end up with identical text; one browser disconnected for 5 minutes, edited, then reconnected merges with no loss.
4. **M3 – Comments.** Threads, mentions, resolve, notifications, server-side enforcement of every row in the permissions table.
   - Done when: a comment stays on its words after 20 lines are inserted above it; a Commenter's attempt to edit script text is rejected by the server, not just hidden in the UI.
5. **M4 – Version history.** Auto snapshots, named drafts, preview, compare, restore.
   - Done when: with a second browser connected, restoring a snapshot from an hour ago shows the restored text and the restore notice in both browsers; the pre-restore state is in history; comments on removed text show as detached.
6. **M5 – Index cards.** Board, acts, loose cards, two-way reorder with the script, scene lock during moves.
   - Done when: moving a card while a collaborator is typing in that scene waits until they pause, then moves the scene; across 20 tries, no text is lost or duplicated.
7. **M6 – Title page, import, export.** PDF, Fountain, .fdx, plain text out; Fountain and .fdx in.
   - Done when: a Fountain file round-trips (import, export, re-import) with no change in text or element types; the PDF page count matches the page view.
8. **M7 – TV profiles and deployment.** Single-cam and multi-cam profiles, act structure, production deploy.
   - Done when: a multi-cam script shows double-spaced dialogue, caps action and lettered scenes in both view and PDF; the team uses it on a real script for a week.

Backups start in M0 because the team will likely write real scripts from M2 onward.

## Open questions

Decide these before or during M0; none blocks starting.

- [ ] **Name check.** The name is Writers Room. Do a quick check that no screenwriting software already uses it as a trademark; the risk is low while the app is internal-only.
- [ ] **Email service.** Which provider sends invites and password resets?
- [ ] **Sign-in.** Email + password, or Google sign-in if the whole team uses Google accounts?
- [ ] **Hosting.** Which server or provider, and who on the team owns backups and updates?
- [ ] **Multi-cam house style.** Is there a specific show or studio format to match? If so, get a sample PDF and set the profile from it.
- [ ] **Existing scripts.** Which formats are current Idu House scripts in (Celtx, Final Draft, Word, Google Docs)? Celtx project files are not on the import list; exporting from Celtx to .fdx or PDF first may be the route. Verify what Celtx's free plan can export.
- [ ] **Dual dialogue.** Needed in v1, or fine as a later phase?
- [ ] **Brand look.** Use Idu House colours and type for the app chrome, or keep it neutral? The mockup uses a neutral dark theme with one gold accent as a starting point.
- [ ] **Later phases.** Confirm the order after v1: script breakdown is the natural next step, then shot lists and storyboards, then scheduling.
