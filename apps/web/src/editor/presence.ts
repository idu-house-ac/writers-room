// Where each collaborator's cursor is, as document positions, from the awareness states.
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';
import { ySyncState } from './ysync';
import type { HocuspocusProvider } from '@hocuspocus/provider';

export interface Collaborator {
  clientId: number;
  id: string;
  name: string;
  color: string;
  /** Absolute document position of the caret head, when known. */
  pos: number | null;
}

export function collaborators(editor: Editor, provider: HocuspocusProvider, selfClientId: number): Collaborator[] {
  const ystate = ySyncState(editor.state);
  const out: Collaborator[] = [];
  const awareness = provider.awareness;
  if (!awareness) return out;
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === selfClientId) continue;
    const user = (state as { user?: { id: string; name: string; color?: string; colour?: string } }).user;
    if (!user) continue;
    let pos: number | null = null;
    const cursor = (state as { cursor?: { anchor: unknown; head: unknown } | null }).cursor;
    if (cursor && ystate) {
      try {
        pos = relativePositionToAbsolutePosition(ystate.doc, ystate.type, Y.createRelativePositionFromJSON(cursor.head), ystate.binding.mapping);
      } catch {
        pos = null;
      }
    }
    out.push({ clientId, id: user.id, name: user.name, color: user.color ?? user.colour ?? '#888', pos });
  }
  return out;
}
