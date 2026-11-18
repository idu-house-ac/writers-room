// Smart typing (BRIEF.md): INT./EXT. starts a scene heading, "(" starts a parenthetical in dialogue,
// an all-caps line ending in TO: becomes a transition. Plus the rule that upper-case elements stay
// upper-case as you type.
import { Extension, InputRule } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { SCENE_PREFIX, type ElementType, type FormatProfile } from '@writers-room/shared';
import { isElementType } from './elements';

export const SCENE_START = /^(?:INT\.\/EXT\.|EXT\.\/INT\.|INT\.|EXT\.|I\/E\.?|EST\.)\s$/i;
export const TRANSITION_LINE = /^[A-Z][A-Z0-9 .,'-]*TO:$/;

/** Given the text of an action line, which element should it become? (null = leave it) */
export function smartTypeTarget(type: ElementType, text: string): ElementType | null {
  if (type === 'action' && SCENE_START.test(text)) return 'sceneHeading';
  if (type === 'action' && TRANSITION_LINE.test(text)) return 'transition';
  if (type === 'dialogue' && text === '(') return 'parenthetical';
  return null;
}

function blockAt(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos);
  if ($pos.depth !== 1) return null;
  const node = $pos.parent;
  return isElementType(node.type.name) ? { $pos, node, type: node.type.name } : null;
}

export function smartTypeRules(): InputRule[] {
  const scene = new InputRule({
    find: SCENE_START,
    handler: ({ state, range }) => {
      const b = blockAt(state, range.from);
      if (!b || b.type !== 'action' || range.from !== b.$pos.start()) return null;
      state.tr.setBlockType(b.$pos.before(1), b.$pos.after(1), state.schema.nodes.sceneHeading!);
    },
  });
  const transition = new InputRule({
    find: TRANSITION_LINE,
    handler: ({ state, range }) => {
      const b = blockAt(state, range.from);
      if (!b || b.type !== 'action' || range.from !== b.$pos.start()) return null;
      state.tr.setBlockType(b.$pos.before(1), b.$pos.after(1), state.schema.nodes.transition!);
    },
  });
  const paren = new InputRule({
    find: /^\($/,
    handler: ({ state, range }) => {
      const b = blockAt(state, range.from);
      if (!b || b.type !== 'dialogue' || range.from !== b.$pos.start()) return null;
      state.tr.setBlockType(b.$pos.before(1), b.$pos.after(1), state.schema.nodes.parenthetical!);
      state.tr.insertText(')', range.to);
      state.tr.setSelection(TextSelection.create(state.tr.doc, range.to));
    },
  });
  return [scene, transition, paren];
}

export const uppercaseKey = new PluginKey('screenplay-uppercase');

/** Keeps elements whose profile case is "upper" in upper case, whatever was typed or pasted. */
export function uppercasePlugin(profile: FormatProfile): Plugin {
  return new Plugin({
    key: uppercaseKey,
    appendTransaction(transactions, _old, newState) {
      if (!transactions.some((t) => t.docChanged)) return null;
      // Collect the top-level blocks touched by the steps.
      const touched = new Set<number>();
      for (const t of transactions) {
        for (const step of t.steps) {
          step.getMap().forEach((_a, _b, newStart, newEnd) => {
            newState.doc.nodesBetween(Math.max(0, newStart), Math.min(newState.doc.content.size, newEnd), (node, pos, parent) => {
              if (parent === newState.doc) {
                touched.add(pos);
                return false;
              }
              return true;
            });
          });
        }
      }
      let tr: Transaction | null = null;
      for (const pos of touched) {
        const node = newState.doc.nodeAt(pos);
        if (!node || !isElementType(node.type.name)) continue;
        if (profile.elements[node.type.name].textCase !== 'upper') continue;
        node.forEach((child, offset) => {
          if (!child.isText || !child.text) return;
          const upper = child.text.toUpperCase();
          if (upper === child.text) return;
          tr ??= newState.tr;
          const from = pos + 1 + offset;
          tr.insertText(upper, from, from + child.text.length);
        });
      }
      return tr;
    },
  });
}

export const SmartType = Extension.create<{ profile: FormatProfile }>({
  name: 'smartType',
  addOptions() {
    return { profile: undefined as unknown as FormatProfile };
  },
  addInputRules() {
    return smartTypeRules();
  },
  addProseMirrorPlugins() {
    return [uppercasePlugin(this.options.profile)];
  },
});

export { SCENE_PREFIX };
