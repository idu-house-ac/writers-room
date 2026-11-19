-- Comments: threads anchored to CRDT relative positions (so they follow edits), replies, notifications.

create type thread_status as enum ('open', 'resolved', 'detached');

create table comment_threads (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  anchor_start text not null,            -- base64 Yjs relative position
  anchor_end   text not null,
  quoted_text  text not null,
  status       thread_status not null default 'open',
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now(),
  resolved_by  uuid references users(id),
  resolved_at  timestamptz
);
create index comment_threads_project_idx on comment_threads(project_id);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references comment_threads(id) on delete cascade,
  author_id  uuid not null references users(id),
  body       text not null,
  mentions   uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index comments_thread_idx on comments(thread_id);

create type notification_type as enum ('mention', 'reply', 'invite');

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       notification_type not null,
  payload    jsonb not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, read_at, created_at desc);
