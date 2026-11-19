// Comment anchors are Yjs relative positions: they stay attached to the same characters while the
// text around them changes. Stored as base64; resolved against the live document when drawing.
import type { EditorState } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';
import { ySyncState } from '../editor/ysync';

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function encodeAnchor(state: EditorState, pos: number): string | null {
  const ystate = ySyncState(state);
  if (!ystate) return null;
  const rel = absolutePositionToRelativePosition(pos, ystate.type, ystate.binding.mapping);
  return rel ? toB64(Y.encodeRelativePosition(rel)) : null;
}

export interface ResolvedRange {
  from: number;
  to: number;
  /** True when the anchored text no longer exists (collapsed or unresolvable). */
  detached: boolean;
}

/**
 * Resolve a thread's anchors to document positions. `previous` is the state before the current
 * transaction: plugin states are built in order, and the Yjs sync state is not on the new state yet
 * while earlier plugins run, so it is read from the previous state when needed.
 */
export function resolveAnchors(state: EditorState, anchorStart: string, anchorEnd: string, previous?: EditorState): ResolvedRange {
  const ystate = ySyncState(state) ?? (previous ? ySyncState(previous) : undefined);
  if (!ystate) return { from: 0, to: 0, detached: true };
  try {
    const from = relativePositionToAbsolutePosition(ystate.doc, ystate.type, Y.decodeRelativePosition(fromB64(anchorStart)), ystate.binding.mapping);
    const to = relativePositionToAbsolutePosition(ystate.doc, ystate.type, Y.decodeRelativePosition(fromB64(anchorEnd)), ystate.binding.mapping);
    if (from === null || to === null) return { from: 0, to: 0, detached: true };
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    return { from: a, to: b, detached: a === b };
  } catch {
    return { from: 0, to: 0, detached: true };
  }
}

