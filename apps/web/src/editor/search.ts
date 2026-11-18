// Find and replace: highlights every match, tracks the current one, replaces one or all.
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchState {
  query: string;
  matches: { from: number; to: number }[];
  current: number;
  decorations: DecorationSet;
}

export const searchKey = new PluginKey<SearchState>('search');

function findMatches(state: EditorState, query: string): { from: number; to: number }[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  const out: { from: number; to: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent.toLowerCase();
    let i = text.indexOf(needle);
    while (i >= 0) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length });
      i = text.indexOf(needle, i + needle.length);
    }
    return false;
  });
  return out;
}

function build(state: EditorState, query: string, current: number): SearchState {
  const matches = findMatches(state, query);
  const idx = matches.length ? ((current % matches.length) + matches.length) % matches.length : 0;
  const decorations = DecorationSet.create(
    state.doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === idx ? 'search-match search-current' : 'search-match' })),
  );
  return { query, matches, current: idx, decorations };
}

export function searchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchKey,
    state: {
      init: () => ({ query: '', matches: [], current: 0, decorations: DecorationSet.empty }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(searchKey) as { query?: string; step?: number } | undefined;
        if (meta?.query !== undefined) return build(state, meta.query, 0);
        if (meta?.step !== undefined) return build(state, prev.query, prev.current + meta.step);
        if (tr.docChanged && prev.query) return build(state, prev.query, prev.current);
        return prev;
      },
    },
    props: {
      decorations: (state) => searchKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}

export function setSearch(tr: Transaction, query: string): Transaction {
  return tr.setMeta(searchKey, { query }).setMeta('addToHistory', false);
}

export function stepSearch(state: EditorState, step: number): Transaction {
  const tr = state.tr.setMeta(searchKey, { step }).setMeta('addToHistory', false);
  const st = searchKey.getState(state);
  if (st && st.matches.length) {
    const next = st.matches[(((st.current + step) % st.matches.length) + st.matches.length) % st.matches.length]!;
    tr.setSelection(TextSelection.create(state.doc, next.from, next.to)).scrollIntoView();
  }
  return tr;
}

export function replaceCurrent(state: EditorState, replacement: string): Transaction | null {
  const st = searchKey.getState(state);
  const m = st?.matches[st.current];
  if (!st || !m) return null;
  return state.tr.insertText(replacement, m.from, m.to);
}

export function replaceAll(state: EditorState, replacement: string): Transaction | null {
  const st = searchKey.getState(state);
  if (!st || !st.matches.length) return null;
  const tr = state.tr;
  for (const m of [...st.matches].reverse()) tr.insertText(replacement, m.from, m.to);
  return tr;
}
