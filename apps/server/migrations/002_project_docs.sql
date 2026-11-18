-- The live shared document per project (Yjs state as binary) plus the page count derived from it.
create table project_docs (
  project_id uuid primary key references projects(id) on delete cascade,
  crdt_state bytea not null,
  page_count integer not null default 0,
  updated_at timestamptz not null default now()
);
