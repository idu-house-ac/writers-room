// Page view: runs the shared pagination engine on the document and draws page breaks, (MORE) and
// NAME (CONT'D) as decorations. Draft view skips all of it.
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { paginate, type FormatProfile, type PaginationResult, type WrappedLine } from '@writers-room/shared';
import { docBlocks } from './blocks';

export type ViewMode = 'page' | 'draft';

export interface PaginationState {
  mode: ViewMode;
  result: PaginationResult | null;
  decorations: DecorationSet;
  dirty: boolean;
}

export const paginationKey = new PluginKey<PaginationState>('pagination');

const RECOMPUTE_DELAY_MS = 120;

function pageBreakDom(page: number, more: string | null, contd: string | null, unusedLines: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'page-break';
  el.contentEditable = 'false';
  el.dataset.page = String(page);
  if (more) {
    const m = document.createElement('div');
    m.className = 'pb-more';
    m.textContent = more;
    el.appendChild(m);
  }
  const gap = document.createElement('div');
  gap.className = 'pb-gap';
  const bottom = document.createElement('div');
  bottom.className = 'pb-bottom';
  // Fill the lines the previous page left unused, so every page draws at its full height.
  bottom.style.height = `calc(var(--page-bottom) + ${unusedLines} * var(--line))`;
  const dark = document.createElement('div');
  dark.className = 'pb-dark';
  const top = document.createElement('div');
  top.className = 'pb-top';
  const num = document.createElement('span');
  num.className = 'pb-number';
  num.textContent = `${page}.`;
  top.appendChild(num);
  gap.append(bottom, dark, top);
  el.appendChild(gap);
  if (contd) {
    const c = document.createElement('div');
    c.className = 'pb-contd';
    c.textContent = contd;
    el.appendChild(c);
  }
  return el;
}

function compute(state: EditorState, profile: FormatProfile, mode: ViewMode, cache: Map<string, WrappedLine[]>): { result: PaginationResult; decorations: DecorationSet } {
  const { blocks, positions, nodes } = docBlocks(state.doc);
  if (cache.size > 50_000) cache.clear();
  const result = paginate(blocks, profile, cache);
  if (mode === 'draft') return { result, decorations: DecorationSet.empty };

  const decos: Decoration[] = [];
  for (let i = 1; i < result.pages.length; i++) {
    const page = result.pages[i]!;
    const first = page.entries[0];
    if (!first) continue;
    const prev = result.pages[i - 1]!;
    const prevLast = prev.entries.at(-1);
    const unused = result.linesPerPage - prev.usedLines;
    const blockPos = positions[first.block]!;
    if (first.lineFrom === 0) {
      decos.push(
        Decoration.widget(blockPos, () => pageBreakDom(page.number, null, null, unused), { side: -1, key: `pb-${page.number}-${unused}`, ignoreSelection: true }),
        Decoration.node(blockPos, blockPos + nodes[first.block]!.nodeSize, { class: 'page-start' }),
      );
    } else {
      const pos = blockPos + 1 + first.charFrom;
      const more = prevLast?.more ? profile.continuation.more : null;
      decos.push(Decoration.widget(pos, () => pageBreakDom(page.number, more, first.contdCue ?? null, unused), { side: -1, key: `pb-${page.number}-${first.charFrom}-${unused}`, ignoreSelection: true }));
    }
  }
  return { result, decorations: DecorationSet.create(state.doc, decos) };
}

export function paginationPlugin(profile: FormatProfile, initialMode: ViewMode): Plugin<PaginationState> {
  const cache = new Map<string, WrappedLine[]>();
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init(_config, state) {
        return { mode: initialMode, dirty: false, ...compute(state, profile, initialMode, cache) };
      },
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(paginationKey) as { mode?: ViewMode; recompute?: boolean } | undefined;
        const mode = meta?.mode ?? prev.mode;
        if (meta?.recompute || (meta?.mode && meta.mode !== prev.mode)) {
          return { mode, dirty: false, ...compute(state, profile, mode, cache) };
        }
        if (tr.docChanged) {
          return { mode, result: prev.result, dirty: true, decorations: prev.decorations.map(tr.mapping, tr.doc) };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const fill = (v: EditorView) => {
        const st = paginationKey.getState(v.state);
        const last = st?.result?.pages.at(-1);
        const lines = st?.mode === 'page' && last ? Math.max(0, (st.result?.linesPerPage ?? 0) - last.usedLines) : 0;
        v.dom.style.setProperty('--fill-lines', String(lines));
        if (import.meta.env.DEV) (window as unknown as { __wrPagination?: PaginationResult | null }).__wrPagination = st?.result ?? null;
      };
      fill(view);
      return {
        update(v) {
          const st = paginationKey.getState(v.state);
          if (st?.dirty && !timer) {
            timer = setTimeout(() => {
              timer = null;
              v.dispatch(v.state.tr.setMeta(paginationKey, { recompute: true }).setMeta('addToHistory', false));
            }, RECOMPUTE_DELAY_MS);
          }
          if (!st?.dirty) fill(v);
        },
        destroy() {
          if (timer) clearTimeout(timer);
        },
      };
    },
  });
}

export function setViewMode(tr: Transaction, mode: ViewMode): Transaction {
  return tr.setMeta(paginationKey, { mode }).setMeta('addToHistory', false);
}
