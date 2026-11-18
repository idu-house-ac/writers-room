// Every Enter/Tab transition from the table in BRIEF.md, run on ProseMirror state without a DOM.
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { ELEMENT_TYPES, FEATURE_PROFILE, type ElementType } from '@writers-room/shared';
import { baseExtensions } from './elements';
import { enterCommand, setElement, tabCommand, skipClosingParen, EMPTY_ENTER_TARGET } from './commands';
import { smartTypeTarget, uppercasePlugin } from './smartType';

const schema = getSchema(baseExtensions);
const P = FEATURE_PROFILE;

function docOf(blocks: [ElementType, string][]): PmNode {
  return schema.nodes.doc!.create(null, blocks.map(([type, text]) => schema.nodes[type]!.create(null, text ? schema.text(text) : null)));
}

/** State with the cursor in block `index` at `offset` (default: end of the block). */
function stateAt(blocks: [ElementType, string][], index = blocks.length - 1, offset?: number, plugins = [uppercasePlugin(P)]) {
  const doc = docOf(blocks);
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const inner = pos + 1 + (offset ?? doc.child(index).content.size);
  return EditorState.create({ doc, plugins, selection: TextSelection.create(doc, inner) });
}

function run(state: EditorState, command: (s: EditorState, d: (tr: import('@tiptap/pm/state').Transaction) => void) => boolean) {
  let next = state;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { ok, state: next, blocks: shape(next), cursorBlock: next.selection.$from.index(0), cursorOffset: next.selection.$from.parentOffset };
}

const shape = (s: EditorState): [string, string][] => {
  const out: [string, string][] = [];
  s.doc.forEach((n) => out.push([n.type.name, n.textContent]));
  return out;
};

describe('Enter at the end of a filled block follows the table', () => {
  for (const type of ELEMENT_TYPES) {
    it(`${type} → ${P.elements[type].enterTo}`, () => {
      const text = type === 'parenthetical' ? '(beat)' : type === 'transition' ? 'CUT TO:' : 'Some text';
      const r = run(stateAt([[type, text]]), enterCommand(P));
      expect(r.ok).toBe(true);
      expect(r.blocks).toEqual([[type, text], [P.elements[type].enterTo, '']]);
      expect(r.cursorBlock).toBe(1);
    });
  }
});

describe('Enter on an empty block converts it in place', () => {
  for (const type of ELEMENT_TYPES) {
    const target = EMPTY_ENTER_TARGET[type];
    it(`${type} → ${target}`, () => {
      const r = run(stateAt([['action', 'Above.'], [type, '']]), enterCommand(P));
      expect(r.ok).toBe(true);
      if (target === type) {
        expect(r.blocks).toEqual([['action', 'Above.'], [type, ''], ['action', '']]);
        expect(r.cursorBlock).toBe(2);
      } else {
        expect(r.blocks).toEqual([['action', 'Above.'], [target, '']]);
        expect(r.cursorBlock).toBe(1);
      }
    });
  }
});

describe('Enter inside a block splits it and keeps the element', () => {
  it('splits dialogue mid-sentence', () => {
    const r = run(stateAt([['character', 'ANNA'], ['dialogue', 'Hello there']], 1, 5), enterCommand(P));
    expect(r.blocks).toEqual([['character', 'ANNA'], ['dialogue', 'Hello'], ['dialogue', ' there']]);
    expect(r.cursorBlock).toBe(2);
    expect(r.cursorOffset).toBe(0);
  });
  it('replaces a selection before splitting', () => {
    const base = stateAt([['action', 'Hello cruel world']], 0, 5);
    const withSel = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 6, 12)));
    const r = run(withSel, enterCommand(P));
    expect(r.blocks).toEqual([['action', 'Hello'], ['action', ' world']]);
  });
});

describe('Tab on an empty block converts it in place', () => {
  for (const type of ELEMENT_TYPES) {
    it(`${type} → ${P.elements[type].tabTo}`, () => {
      const r = run(stateAt([[type, '']]), tabCommand(P));
      expect(r.ok).toBe(true);
      const target = P.elements[type].tabTo;
      expect(r.blocks).toEqual([[target, target === 'parenthetical' ? '()' : '']]);
      if (target === 'parenthetical') expect(r.cursorOffset).toBe(1);
    });
  }
});

describe('Tab after a filled block adds the next element', () => {
  for (const type of ELEMENT_TYPES) {
    const target = type === 'character' ? 'parenthetical' : P.elements[type].tabTo;
    it(`${type} → ${target}`, () => {
      const text = type === 'parenthetical' ? '(beat)' : 'Text';
      const r = run(stateAt([[type, text]]), tabCommand(P));
      expect(r.blocks).toEqual([[type, text], [target, target === 'parenthetical' ? '()' : '']]);
      expect(r.cursorBlock).toBe(1);
      if (target === 'parenthetical') expect(r.cursorOffset).toBe(1);
    });
  }
});

describe('element switching', () => {
  it('Mod+N sets the element of the current block', () => {
    const r = run(stateAt([['action', 'bob']]), setElement('character'));
    expect(r.blocks).toEqual([['character', 'BOB']]); // the uppercase rule runs on the appended transaction
  });
  it('typing ")" before an auto-closed bracket skips over it', () => {
    const r = run(stateAt([['parenthetical', '(beat)']], 0, 5), skipClosingParen());
    expect(r.ok).toBe(true);
    expect(r.cursorOffset).toBe(6);
    expect(run(stateAt([['parenthetical', '(beat)']], 0, 2), skipClosingParen()).ok).toBe(false);
  });
});

describe('uppercase rule', () => {
  it('upper-cases scene headings, characters, transitions and shots but not action or dialogue', () => {
    for (const type of ELEMENT_TYPES) {
      const s = stateAt([[type, '']]);
      const next = s.apply(s.tr.insertText('mixed Case'));
      const expected = P.elements[type].textCase === 'upper' ? 'MIXED CASE' : 'mixed Case';
      expect(next.doc.firstChild!.textContent, type).toBe(expected);
    }
  });
  it('keeps the cursor in place while upper-casing', () => {
    const s = stateAt([['character', '']]);
    const next = s.apply(s.tr.insertText('anna'));
    expect(next.selection.$from.parentOffset).toBe(4);
  });
});

describe('smart typing targets', () => {
  it('detects scene heading prefixes at the start of an action line', () => {
    for (const t of ['INT. ', 'EXT. ', 'int. ', 'INT./EXT. ', 'I/E ', 'EST. ']) expect(smartTypeTarget('action', t), t).toBe('sceneHeading');
    expect(smartTypeTarget('action', 'INTERIOR ')).toBeNull();
    expect(smartTypeTarget('dialogue', 'INT. ')).toBeNull();
  });
  it('detects transitions and parentheticals', () => {
    expect(smartTypeTarget('action', 'CUT TO:')).toBe('transition');
    expect(smartTypeTarget('action', 'SMASH CUT TO:')).toBe('transition');
    expect(smartTypeTarget('action', 'He walked to:')).toBeNull();
    expect(smartTypeTarget('dialogue', '(')).toBe('parenthetical');
    expect(smartTypeTarget('action', '(')).toBeNull();
  });
});

describe('typing a scene with Enter, Tab and text only', () => {
  it('produces the right elements for a short sequence', () => {
    let s = stateAt([['action', '']]);
    const type = (text: string) => (s = s.apply(s.tr.insertText(text)));
    const key = (cmd: (st: EditorState, d: (tr: import('@tiptap/pm/state').Transaction) => void) => boolean) => (s = run(s, cmd).state);
    // INT. ... would be converted by the input rule in the live editor; here we set it directly.
    s = run(s, setElement('sceneHeading')).state;
    type('INT. KITCHEN - DAY');
    key(enterCommand(P)); // → action
    type('Anna pours coffee.');
    key(tabCommand(P)); // → character
    type('Anna');
    key(enterCommand(P)); // → dialogue
    type('Morning.');
    key(tabCommand(P)); // → parenthetical with ()
    type('yawning');
    key(enterCommand(P)); // → dialogue
    type('Long night.');
    key(enterCommand(P)); // → action
    key(tabCommand(P)); // empty action → character
    type('Bob');
    key(enterCommand(P));
    type('Tell me about it.');
    key(enterCommand(P)); // → action
    type('CUT TO:');
    expect(shape(s)).toEqual([
      ['sceneHeading', 'INT. KITCHEN - DAY'],
      ['action', 'Anna pours coffee.'],
      ['character', 'ANNA'],
      ['dialogue', 'Morning.'],
      ['parenthetical', '(yawning)'],
      ['dialogue', 'Long night.'],
      ['character', 'BOB'],
      ['dialogue', 'Tell me about it.'],
      ['action', 'CUT TO:'],
    ]);
  });
});
