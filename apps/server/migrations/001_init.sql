-- Writers Room: accounts, projects, members, invites. Document and history tables arrive with M1/M4.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,          -- always stored lower-cased
  name          text not null,
  avatar_url    text,
  colour        text not null,                 -- presence / cursor colour
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table sessions (
  id           text primary key,                -- random, only ever sent in an httpOnly cookie
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index sessions_user_id_idx on sessions(user_id);

create table password_resets (
  token_hash text primary key,                  -- sha256 of the token in the emailed link
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create type format_profile as enum ('feature', 'tv_single', 'tv_multi');
create type member_role    as enum ('owner', 'writer', 'commenter', 'reader');

create table projects (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  format_profile format_profile not null,
  created_by     uuid not null references users(id),
  updated_by     uuid references users(id),
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       member_role not null,
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_id_idx on project_members(user_id);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,                    -- lower-cased
  project_id  uuid not null references projects(id) on delete cascade,
  role        member_role not null,
  token_hash  text not null unique,             -- sha256 of the single-use token in the link
  invited_by  uuid not null references users(id),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index invites_project_id_idx on invites(project_id);
create index invites_email_idx on invites(email);
