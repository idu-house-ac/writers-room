# Writers Room — working rules

Read `BRIEF.md` first. It is the product spec. Mockup screenshots, when present, live in `docs/mockup/`.

## Rules

- Work one milestone at a time. Stop at each milestone's acceptance criteria and report.
- Library names, versions and APIs in the brief are a starting point, not verified facts. Check each package's current documentation before using it, and say when something is out of date. Record version decisions in `docs/decisions.md`.
- Use only open-source dependencies under permissive licenses (MIT, Apache-2.0, BSD, ISC, SIL OFL for fonts). Flag anything else before adding it.
- Write automated tests for formatting, smart-type transitions and pagination. These are where screenwriting apps break.
- Never add usage limits, plan tiers, upgrade prompts or feature flags tied to payment. No plan or billing concepts in the data model.
- Keep everything runnable on one machine with a single command (`docker compose up`) so the team can self-host.
- The server enforces every permission; the UI only hides what a role cannot do.
- The pagination engine is one shared module used by the page view, the PDF export and the page count. Never paginate in two places.
- Never hard-code screenplay indents in CSS or PDF code; read them from the format profile.
- The app must not use the Celtx name, logo, wording or visual design.

## Layout

- `apps/server` — Fastify API (TypeScript). Auth, projects, members, invites, mail, backups.
- `apps/web` — React + Vite front end.
- `packages/shared` — types shared by server and web (roles, API payloads; later format profiles and pagination).
- `deploy/` — Docker Compose files, backup scripts.
- `docs/` — brief, mockups, decisions, runbooks.

## Commands

- `docker compose up` — run everything (web on :5173, API and collaboration WebSocket on :3000, Mailpit on :8025).
- `pnpm install` then `pnpm dev` — run web and server locally against a Postgres you provide.
- `pnpm test` — all tests. `pnpm typecheck` — TypeScript across the workspace.
