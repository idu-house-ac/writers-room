// Highlights for open comment threads, resolved from their anchors on every change.
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { CommentThread } from '@writers-room/shared';
import { resolveAnchors } from './anchors';

export interface CommentMarksState {
  threads: CommentThread[];
  activeId: string | null;
  decorations: DecorationSet;
  /** Resolved ranges by thread id, for the panel (ordering, detached state, jump-to). */
  ranges: Map<string, { from: number; to: number; detached: boolean }>;
  /** The document changed since the last resolution from anchors. */
  dirty: boolean;
}

export const commentMarksKey = new PluginKey<CommentMarksState>('commentMarks');

function build(state: EditorState, previous: EditorState | undefined, threads: CommentThread[], activeId: string | null): CommentMarksState {
  const decos: Decoration[] = [];
  const ranges = new Map<string, { from: number; to: number; detached: boolean }>();
  for (const t of threads) {
    const r = resolveAnchors(state, t.anchorStart, t.anchorEnd, previous);
    ranges.set(t.id, r);
    if (r.detached || t.status !== 'open') continue;
    decos.push(
      Decoration.inline(r.from, r.to, {
        class: `comment-mark${t.id === activeId ? ' comment-mark-active' : ''}`,
        'data-thread': t.id,
      }),
    );
  }
  return { threads, activeId, decorations: DecorationSet.create(state.doc, decos), ranges, dirty: false };
}

export function commentMarksPlugin(): Plugin<CommentMarksState> {
  return new Plugin<CommentMarksState>({
    key: commentMarksKey,
    state: {
      init: (_c, state) => build(state, undefined, [], null),
      apply(tr, prev, old, state) {
        const meta = tr.getMeta(commentMarksKey) as { threads?: CommentThread[]; activeId?: string | null; recompute?: boolean } | undefined;
        if (meta) return build(state, old, meta.threads ?? prev.threads, meta.activeId === undefined ? prev.activeId : meta.activeId);
        // Keep highlights aligned through the edit now; resolve them exactly from the anchors right after.
        if (tr.docChanged) return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc), dirty: true };
        return prev;
      },
    },
    view() {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        update(view) {
          const st = commentMarksKey.getState(view.state);
          if (st?.dirty && !timer) {
            timer = setTimeout(() => {
              timer = null;
              if (!commentMarksKey.getState(view.state)?.dirty) return;
              view.dispatch(view.state.tr.setMeta(commentMarksKey, { recompute: true }).setMeta('addToHistory', false));
            }, 50);
          }
        },
        destroy() {
          if (timer) clearTimeout(timer);
        },
      };
    },
    props: {
      decorations: (state) => commentMarksKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleClick(view, pos) {
        const st = commentMarksKey.getState(view.state);
        if (!st) return false;
        const hit = st.threads.find((t) => {
          const r = st.ranges.get(t.id);
          return r && !r.detached && t.status === 'open' && pos >= r.from && pos <= r.to;
        });
        if (hit) {
          view.dispatch(view.state.tr.setMeta(commentMarksKey, { activeId: hit.id }));
          window.dispatchEvent(new CustomEvent('wr:open-thread', { detail: hit.id }));
        }
        return false;
      },
    },
  });
}
