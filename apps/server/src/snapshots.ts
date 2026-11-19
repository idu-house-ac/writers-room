// Version history: full copies of the document. Automatic ones come from the collaboration server
// (every SNAPSHOT_INTERVAL of editing, and when the last person leaves); named drafts and
// "before restore" copies come from the API.
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { FormatProfileId, ScriptJson, SnapshotDetail, SnapshotKind, SnapshotSummary, UserSummary } from '@writers-room/shared';
import type { Queryable } from './db';
import { docJsonToBlocks, pageCountOf, SCRIPT_FIELD } from './docs';

export function scriptJson(ydoc: Y.Doc): ScriptJson {
  return yDocToProsemirrorJSON(ydoc, SCRIPT_FIELD) as ScriptJson;
}

export function contentHash(json: ScriptJson): string {
  return createHash('sha256').update(JSON.stringify(json.content ?? [])).digest('hex');
}

export async function latestHash(db: Queryable, projectId: string): Promise<string | null> {
  const { rows } = await db.query<{ content_hash: string }>('select content_hash from snapshots where project_id = $1 order by created_at desc limit 1', [projectId]);
  return rows[0]?.content_hash ?? null;
}

export interface TakeSnapshotOptions {
  kind: SnapshotKind;
  name?: string | null;
  createdBy?: string | null;
  authors?: string[];
  profile: FormatProfileId;
  /** Skip when the content equals the most recent snapshot (used by automatic snapshots). */
  skipIfUnchanged?: boolean;
}

export async function takeSnapshot(db: Queryable, projectId: string, ydoc: Y.Doc, opts: TakeSnapshotOptions): Promise<string | null> {
  const json = scriptJson(ydoc);
  const hash = contentHash(json);
  if (opts.skipIfUnchanged && (await latestHash(db, projectId)) === hash) return null;
  const pageCount = pageCountOf(docJsonToBlocks(json), opts.profile);
  const { rows } = await db.query<{ id: string }>(
    `insert into snapshots (project_id, crdt_snapshot, content, content_hash, page_count, name, kind, authors, created_by)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::uuid[], $9) returning id`,
    [projectId, Buffer.from(Y.encodeStateAsUpdate(ydoc)), JSON.stringify(json), hash, pageCount, opts.name ?? null, opts.kind, opts.authors ?? [], opts.createdBy ?? null],
  );
  return rows[0]!.id;
}

const USER_JSON = (alias: string) =>
  `json_build_object('id', ${alias}.id, 'name', ${alias}.name, 'email', ${alias}.email, 'avatarUrl', ${alias}.avatar_url, 'colour', ${alias}.colour)`;

interface Row {
  id: string;
  kind: SnapshotKind;
  name: string | null;
  page_count: number;
  created_at: Date;
  creator: UserSummary | null;
  author_list: UserSummary[];
  content?: ScriptJson;
}

const SELECT = (withContent: boolean) => `
  select s.id, s.kind, s.name, s.page_count, s.created_at, ${withContent ? 's.content,' : ''}
         case when cu.id is null then null else ${USER_JSON('cu')} end as creator,
         coalesce((select json_agg(${USER_JSON('au')}) from users au where au.id = any(s.authors)), '[]'::json) as author_list
    from snapshots s left join users cu on cu.id = s.created_by`;

function toSummary(r: Row): SnapshotSummary {
  return { id: r.id, kind: r.kind, name: r.name, pageCount: r.page_count, authors: r.author_list, createdBy: r.creator, createdAt: r.created_at.toISOString() };
}

export async function listSnapshots(db: Queryable, projectId: string): Promise<SnapshotSummary[]> {
  const { rows } = await db.query<Row>(`${SELECT(false)} where s.project_id = $1 order by s.created_at desc`, [projectId]);
  return rows.map(toSummary);
}

export async function getSnapshot(db: Queryable, projectId: string, id: string): Promise<SnapshotDetail | null> {
  const { rows } = await db.query<Row>(`${SELECT(true)} where s.project_id = $1 and s.id = $2`, [projectId, id]);
  const r = rows[0];
  return r ? { ...toSummary(r), content: r.content! } : null;
}

// ---- Applying a snapshot to the live document ----

type PmBlock = NonNullable<ScriptJson['content']>[number];

function blockToY(block: PmBlock): Y.XmlElement {
  const el = new Y.XmlElement(block.type);
  const text = new Y.XmlText();
  let index = 0;
  for (const child of block.content ?? []) {
    if (child.type !== 'text' || !child.text) continue;
    const attrs: Record<string, object> = {};
    for (const m of child.marks ?? []) attrs[m.type] = {};
    text.insert(index, child.text, attrs);
    index += child.text.length;
  }
  if (index > 0) el.insert(0, [text]);
  return el;
}

/** A block's identity for diffing, independent of JSON key order (Postgres jsonb reorders keys). */
export function blockKey(b: PmBlock): string {
  return JSON.stringify([b.type, (b.content ?? []).map((c) => [c.type, c.text ?? '', (c.marks ?? []).map((m) => m.type).sort()])]);
}

/** Longest common subsequence over block keys; returns which old/new indexes are kept. */
export function blockDiff(oldKeys: string[], newKeys: string[]): { keepOld: boolean[]; keepNew: boolean[] } {
  const n = oldKeys.length;
  const m = newKeys.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = oldKeys[i] === newKeys[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const keepOld = new Array<boolean>(n).fill(false);
  const keepNew = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldKeys[i] === newKeys[j]) {
      keepOld[i] = keepNew[j] = true;
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return { keepOld, keepNew };
}

/**
 * Make the live document's script equal to `target`, changing only the blocks that differ so
 * comments on untouched text keep their anchors. Must run inside a Yjs transaction.
 */
export function applyScript(ydoc: Y.Doc, target: ScriptJson): { replaced: number } {
  const frag = ydoc.getXmlFragment(SCRIPT_FIELD);
  const current = scriptJson(ydoc).content ?? [];
  const wanted = target.content ?? [];
  const { keepOld, keepNew } = blockDiff(current.map(blockKey), wanted.map(blockKey));

  // Walk both lists, deleting unmatched old blocks and inserting unmatched new ones, in one pass.
  let pos = 0; // index into the fragment
  let i = 0;
  let j = 0;
  let replaced = 0;
  while (i < current.length || j < wanted.length) {
    if (i < current.length && !keepOld[i]) {
      frag.delete(pos, 1);
      i++;
      replaced++;
      continue;
    }
    if (j < wanted.length && !keepNew[j]) {
      frag.insert(pos, [blockToY(wanted[j]!)]);
      pos++;
      j++;
      replaced++;
      continue;
    }
    // both kept: they match
    i++;
    j++;
    pos++;
  }
  return { replaced };
}

/** Threads whose anchors no longer resolve to live text, after a restore. */
export function detachedThreadIds(ydoc: Y.Doc, threads: { id: string; anchor_start: string; anchor_end: string }[]): string[] {
  const out: string[] = [];
  for (const t of threads) {
    try {
      // Copy out of Node's pooled Buffer: the decoder needs a view that starts at byte 0.
      const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
      const a = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(bytes(t.anchor_start)), ydoc);
      const b = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(bytes(t.anchor_end)), ydoc);
      const deleted = (p: Y.AbsolutePosition | null) => !p || (p.type._item?.deleted ?? false);
      if (deleted(a) || deleted(b) || a!.type !== b!.type || a!.index === b!.index) out.push(t.id);
    } catch {
      out.push(t.id);
    }
  }
  return out;
}
