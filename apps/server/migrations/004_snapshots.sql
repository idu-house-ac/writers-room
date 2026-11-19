-- Version history: full copies of the document, never pruned.
create type snapshot_kind as enum ('auto', 'named', 'pre_restore');

create table snapshots (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  crdt_snapshot bytea not null,            -- full Yjs state at that moment
  content       jsonb not null,            -- ProseMirror JSON of the script, for preview and compare
  content_hash  text not null,
  page_count    integer not null default 0,
  name          text,
  kind          snapshot_kind not null,
  authors       uuid[] not null default '{}',   -- who edited since the previous snapshot
  created_by    uuid references users(id),      -- who named it or triggered the restore
  created_at    timestamptz not null default now()
);
create index snapshots_project_idx on snapshots(project_id, created_at desc);
