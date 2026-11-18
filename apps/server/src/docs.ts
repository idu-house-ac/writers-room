// Script document storage: one Yjs document per project, saved as binary.
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { getProfile, paginate, type ElementType, type FormatProfileId, type ScriptBlock, ELEMENT_TYPES } from '@writers-room/shared';
import type { Queryable } from './db';

/** Name of the Y.XmlFragment that holds the script (the Tiptap `field`). */
export const SCRIPT_FIELD = 'script';

interface PmNode {
  type: string;
  text?: string;
  content?: PmNode[];
}

function textOf(node: PmNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

/** Flatten the ProseMirror JSON of a script into pagination blocks. Unknown node types are skipped. */
export function docJsonToBlocks(json: { content?: PmNode[] }): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  for (const node of json.content ?? []) {
    if ((ELEMENT_TYPES as readonly string[]).includes(node.type)) {
      blocks.push({ type: node.type as ElementType, text: textOf(node) });
    }
  }
  return blocks;
}

export function blocksFromState(state: Uint8Array): ScriptBlock[] {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  const json = yDocToProsemirrorJSON(ydoc, SCRIPT_FIELD) as { content?: PmNode[] };
  return docJsonToBlocks(json);
}

export function pageCountOf(blocks: ScriptBlock[], profile: FormatProfileId): number {
  if (blocks.length === 0 || blocks.every((b) => b.text === '')) return 0;
  return paginate(blocks, getProfile(profile)).pages.length;
}

export interface StoredDoc {
  state: Uint8Array;
  stateVector: Uint8Array;
  pageCount: number;
}

export async function loadDoc(db: Queryable, projectId: string): Promise<StoredDoc | null> {
  const { rows } = await db.query<{ crdt_state: Buffer; page_count: number }>(
    'select crdt_state, page_count from project_docs where project_id = $1',
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  const state = new Uint8Array(row.crdt_state);
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  return { state, stateVector: Y.encodeStateVector(ydoc), pageCount: row.page_count };
}

/**
 * Merge an incoming Yjs update into the stored document. The update may be a full state or a diff;
 * Yjs merges either without conflicts. Returns the new state vector and page count.
 */
export async function mergeDoc(
  db: Queryable,
  projectId: string,
  update: Uint8Array,
  profile: FormatProfileId,
  userId: string,
): Promise<StoredDoc> {
  const existing = await loadDoc(db, projectId);
  const ydoc = new Y.Doc();
  if (existing) Y.applyUpdate(ydoc, existing.state);
  Y.applyUpdate(ydoc, update);
  const state = Y.encodeStateAsUpdate(ydoc);
  const blocks = docJsonToBlocks(yDocToProsemirrorJSON(ydoc, SCRIPT_FIELD) as { content?: PmNode[] });
  const pageCount = pageCountOf(blocks, profile);
  await db.query(
    `insert into project_docs (project_id, crdt_state, page_count, updated_at) values ($1, $2, $3, now())
     on conflict (project_id) do update set crdt_state = excluded.crdt_state, page_count = excluded.page_count, updated_at = now()`,
    [projectId, Buffer.from(state), pageCount],
  );
  await db.query('update projects set updated_at = now(), updated_by = $2 where id = $1', [projectId, userId]);
  return { state, stateVector: Y.encodeStateVector(ydoc), pageCount };
}
