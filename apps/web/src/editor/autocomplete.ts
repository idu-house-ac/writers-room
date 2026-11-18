// Autocomplete from the script itself: character names on character lines, locations and times of
// day on scene headings, extensions after "NAME (". Enter accepts and moves on; Tab accepts; Esc hides.
import { Plugin, PluginKey, type Command, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { EXTENSIONS, extractCharacters, extractLocations, TIMES_OF_DAY, type FormatProfile } from '@writers-room/shared';
import { docBlocks } from './blocks';
import { currentBlock, enterCommand, tabCommand } from './commands';

export interface Suggestion {
  label: string;
  /** Replace the block text from this offset to the cursor with `label`. */
  replaceFrom: number;
}

export interface AutocompleteState {
  items: Suggestion[];
  index: number;
  /** Block text the user dismissed suggestions for; shown again once it changes. */
  dismissed: string | null;
}

export const autocompleteKey = new PluginKey<AutocompleteState>('autocomplete');

const PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'I/E '];
const MAX = 6;

function suggestionsFor(state: EditorState): Suggestion[] {
  if (!state.selection.empty) return [];
  const info = currentBlock(state);
  if (!info || !info.atEnd) return [];
  const text = info.node.textContent;
  const { blocks } = docBlocks(state.doc);

  if (info.type === 'character') {
    const paren = text.lastIndexOf('(');
    if (paren >= 0) {
      const typed = text.slice(paren).toUpperCase();
      return EXTENSIONS.filter((e) => e.startsWith(typed) && e !== typed).map((label) => ({ label, replaceFrom: paren }));
    }
    const typed = text.toUpperCase();
    if (!typed) return []; // an empty cue stays quiet so Tab can cycle elements
    return extractCharacters(blocks)
      .map((c) => c.name)
      .filter((name) => name.startsWith(typed) && name !== typed)
      .slice(0, MAX)
      .map((label) => ({ label, replaceFrom: 0 }));
  }

  if (info.type === 'sceneHeading') {
    const upper = text.toUpperCase();
    const m = upper.match(/^(INT\.\/EXT\.|EXT\.\/INT\.|INT\.|EXT\.|I\/E\.?|EST\.)\s+(.*)$/);
    if (!m) {
      if (!upper) return [];
      return PREFIXES.filter((p) => p.startsWith(upper) && p !== upper).map((label) => ({ label, replaceFrom: 0 }));
    }
    const restStart = m[1]!.length + (upper.length - m[1]!.length - m[2]!.length);
    const rest = m[2]!;
    const dash = rest.lastIndexOf(' - ');
    if (dash >= 0) {
      const after = rest.slice(dash + 3);
      const from = restStart + dash + 3;
      return TIMES_OF_DAY.filter((t) => t.startsWith(after) && t !== after).map((label) => ({ label, replaceFrom: from }));
    }
    return extractLocations(blocks)
      .map((l) => l.location)
      .filter((loc) => loc.startsWith(rest) && loc !== rest)
      .slice(0, MAX)
      .map((label) => ({ label, replaceFrom: restStart }));
  }
  return [];
}

export function acceptSuggestion(): Command {
  return (state, dispatch) => {
    const st = autocompleteKey.getState(state);
    const info = currentBlock(state);
    const item = st?.items[st.index];
    if (!st || !item || !info) return false;
    const from = info.before + 1 + item.replaceFrom;
    dispatch?.(state.tr.insertText(item.label, from, state.selection.from));
    return true;
  };
}

export function autocompletePlugin(profile: FormatProfile): Plugin<AutocompleteState> {
  return new Plugin<AutocompleteState>({
    key: autocompleteKey,
    state: {
      init: () => ({ items: [], index: 0, dismissed: null }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(autocompleteKey) as { move?: number; dismiss?: boolean } | undefined;
        if (meta?.dismiss) {
          const info = currentBlock(state);
          return { items: [], index: 0, dismissed: info ? info.node.textContent : '' };
        }
        if (meta?.move !== undefined && prev.items.length) {
          return { ...prev, index: (prev.index + meta.move + prev.items.length) % prev.items.length };
        }
        if (!tr.docChanged && !tr.selectionSet) return prev;
        const info = currentBlock(state);
        if (prev.dismissed !== null && info && info.node.textContent === prev.dismissed) return { ...prev, items: [] };
        const items = suggestionsFor(state);
        return { items, index: 0, dismissed: null };
      },
    },
    props: {
      handleKeyDown(view, event) {
        const st = autocompleteKey.getState(view.state);
        if (!st || !st.items.length) return false;
        switch (event.key) {
          case 'ArrowDown':
            view.dispatch(view.state.tr.setMeta(autocompleteKey, { move: 1 }));
            return true;
          case 'ArrowUp':
            view.dispatch(view.state.tr.setMeta(autocompleteKey, { move: -1 }));
            return true;
          case 'Tab':
            // Fill in the name, then do what Tab normally does after a filled line (a parenthetical).
            acceptSuggestion()(view.state, view.dispatch);
            return tabCommand(profile)(view.state, view.dispatch);
          case 'Enter':
            acceptSuggestion()(view.state, view.dispatch);
            return enterCommand(profile)(view.state, view.dispatch);
          case 'Escape':
            view.dispatch(view.state.tr.setMeta(autocompleteKey, { dismiss: true }));
            return true;
        }
        return false;
      },
    },
    view: (view) => new AutocompleteView(view),
  });
}

class AutocompleteView {
  private el: HTMLDivElement;
  constructor(private view: EditorView) {
    this.el = document.createElement('div');
    this.el.className = 'autocomplete';
    this.el.setAttribute('role', 'listbox');
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
    this.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const target = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
      if (!target) return;
      const index = Number(target.dataset.index);
      const st = autocompleteKey.getState(view.state);
      if (!st) return;
      view.dispatch(view.state.tr.setMeta(autocompleteKey, { move: index - st.index }));
      acceptSuggestion()(view.state, view.dispatch);
      view.focus();
    });
    this.update(view);
  }
  update(view: EditorView) {
    const st = autocompleteKey.getState(view.state);
    if (!st || !st.items.length || !view.hasFocus()) {
      this.el.style.display = 'none';
      this.el.innerHTML = '';
      return;
    }
    this.el.innerHTML = '';
    st.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `ac-item${i === st.index ? ' active' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === st.index));
      row.dataset.index = String(i);
      row.textContent = item.label;
      this.el.appendChild(row);
    });
    const coords = view.coordsAtPos(view.state.selection.from);
    this.el.style.display = 'block';
    this.el.style.left = `${Math.min(coords.left, window.innerWidth - 260)}px`;
    this.el.style.top = `${coords.bottom + 4}px`;
  }
  destroy() {
    this.el.remove();
  }
}
