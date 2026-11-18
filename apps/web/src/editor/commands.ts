// Pure ProseMirror commands for Enter, Tab and element switching. They take an EditorState and work
// without a DOM, so the transition table from BRIEF.md is unit-tested directly (see commands.test.ts).
import { TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PmNode, ResolvedPos } from '@tiptap/pm/model';
import type { ElementType, FormatProfile } from '@writers-room/shared';
import { isElementType } from './elements';

export interface BlockInfo {
  type: ElementType;
  node: PmNode;
  /** Position before the block node. */
  before: number;
  /** Position after the block node. */
  after: number;
  /** Cursor offset within the block's text. */
  offset: number;
  empty: boolean;
  atEnd: boolean;
}

/** The top-level block the cursor is in, or null when the selection spans blocks. */
export function currentBlock(state: EditorState): BlockInfo | null {
  const { $from, $to } = state.selection;
  if ($from.depth !== 1 || $to.depth !== 1 || $from.index(0) !== $to.index(0)) return null;
  const node = $from.parent;
  if (!isElementType(node.type.name)) return null;
  return {
    type: node.type.name,
    node,
    before: $from.before(1),
    after: $from.after(1),
    offset: $from.parentOffset,
    empty: node.content.size === 0,
    atEnd: $from.parentOffset === node.content.size,
  };
}

/** Where Enter on an EMPTY block takes it (converted in place). Action gets a fresh action line. */
export const EMPTY_ENTER_TARGET: Record<ElementType, ElementType> = {
  sceneHeading: 'action',
  action: 'action',
  character: 'action',
  parenthetical: 'dialogue',
  dialogue: 'action',
  transition: 'action',
  shot: 'action',
  centered: 'action',
};

/** End of the block, or just before the auto-closed ")" of a parenthetical. */
function atLogicalEnd(type: ElementType, node: PmNode, offset: number): boolean {
  if (offset === node.content.size) return true;
  return type === 'parenthetical' && node.textBetween(offset, node.content.size) === ')';
}

function convertInPlace(tr: Transaction, $pos: ResolvedPos, type: ElementType): Transaction {
  return tr.setBlockType($pos.before(1), $pos.after(1), tr.doc.type.schema.nodes[type]!);
}

function insertBlockAfter(tr: Transaction, $pos: ResolvedPos, type: ElementType, text = '', cursorOffset?: number): Transaction {
  const schema = tr.doc.type.schema;
  const after = $pos.after(1);
  const node = schema.nodes[type]!.create(null, text ? schema.text(text) : null);
  tr.insert(after, node);
  const cursor = after + 1 + (cursorOffset ?? text.length);
  return tr.setSelection(TextSelection.create(tr.doc, cursor));
}

/** Change the current block(s) to another element type. */
export function setElement(type: ElementType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if ($from.depth < 1 || $to.depth < 1) return false;
    const nodeType = state.schema.nodes[type];
    if (!nodeType) return false;
    if (dispatch) dispatch(state.tr.setBlockType($from.before(1), $to.after(1), nodeType).scrollIntoView());
    return true;
  };
}

/**
 * Enter:
 *  - empty block: convert it in place (EMPTY_ENTER_TARGET), or add a new action line after an action
 *  - cursor at the end: new block of the element's `enterTo` type
 *  - cursor inside: split; the second half keeps the element type
 */
export function enterCommand(profile: FormatProfile): Command {
  return (state, dispatch) => {
    const info = currentBlock(state);
    if (!info) return false;
    const rule = profile.elements[info.type];
    const tr = state.tr;
    if (!state.selection.empty) tr.deleteSelection();
    const $pos = tr.selection.$from;
    const node = $pos.parent;

    if (node.content.size === 0) {
      const target = EMPTY_ENTER_TARGET[info.type];
      if (target !== info.type) convertInPlace(tr, $pos, target);
      else insertBlockAfter(tr, $pos, target);
    } else if (atLogicalEnd(info.type, node, $pos.parentOffset)) {
      insertBlockAfter(tr, $pos, rule.enterTo);
    } else {
      tr.split($pos.pos);
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * Tab:
 *  - empty block: convert it in place to the element's `tabTo` type
 *  - filled block: new block after it of the `tabTo` type; a filled character cue gets a parenthetical
 *  - a new parenthetical comes with its brackets, cursor between them
 */
export function tabCommand(profile: FormatProfile): Command {
  return (state, dispatch) => {
    const info = currentBlock(state);
    if (!info) return false;
    const rule = profile.elements[info.type];
    const tr = state.tr;
    const $pos = tr.selection.$from;

    if (info.empty) {
      convertInPlace(tr, $pos, rule.tabTo);
      if (rule.tabTo === 'parenthetical') {
        tr.insertText('()', $pos.pos);
        tr.setSelection(TextSelection.create(tr.doc, $pos.pos + 1));
      }
    } else {
      const target: ElementType = info.type === 'character' ? 'parenthetical' : rule.tabTo;
      if (target === 'parenthetical') insertBlockAfter(tr, $pos, target, '()', 1);
      else insertBlockAfter(tr, $pos, target);
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Shift+Tab: step the current block backwards through the element order (action ↔ character etc.). */
export function shiftTabCommand(profile: FormatProfile): Command {
  return (state, dispatch) => {
    const info = currentBlock(state);
    if (!info) return false;
    // Reverse of tabTo for the common cases; otherwise action.
    const reverse: Partial<Record<ElementType, ElementType>> = { character: 'action', parenthetical: 'dialogue', dialogue: 'character', transition: 'action', sceneHeading: 'action' };
    const target = reverse[info.type] ?? 'action';
    if (target === info.type) return false;
    void profile;
    dispatch?.(convertInPlace(state.tr, state.selection.$from, target).scrollIntoView());
    return true;
  };
}

/** Typing ")" just before an existing ")" skips over it (parentheticals are auto-closed). */
export function skipClosingParen(): Command {
  return (state, dispatch) => {
    const info = currentBlock(state);
    if (!info || info.type !== 'parenthetical' || !state.selection.empty) return false;
    const { $from } = state.selection;
    if ($from.nodeAfter?.text?.startsWith(')')) {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, $from.pos + 1)));
      return true;
    }
    return false;
  };
}
