import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import type { ElementType } from '@writers-room/shared';
import { baseExtensions } from './elements';
import { moveScene, renameCharacter, sceneRanges } from './blocks';

const schema = getSchema(baseExtensions);
const make = (blocks: [ElementType, string][]) =>
  EditorState.create({ doc: schema.nodes.doc!.create(null, blocks.map(([t, x]) => schema.nodes[t]!.create(null, x ? schema.text(x) : null))) });
const shape = (s: EditorState) => {
  const out: string[] = [];
  s.doc.forEach((n) => out.push(n.textContent));
  return out;
};

const script: [ElementType, string][] = [
  ['sceneHeading', 'INT. A - DAY'],
  ['action', 'a1'],
  ['sceneHeading', 'INT. B - DAY'],
  ['action', 'b1'],
  ['action', 'b2'],
  ['sceneHeading', 'INT. C - DAY'],
  ['action', 'c1'],
];

describe('scenes', () => {
  it('finds scene ranges', () => {
    const r = sceneRanges(make(script).doc);
    expect(r.map((s) => [s.number, s.heading, s.block])).toEqual([[1, 'INT. A - DAY', 0], [2, 'INT. B - DAY', 2], [3, 'INT. C - DAY', 5]]);
  });
  it('moves a scene down and up', () => {
    const s = make(script);
    const down = s.apply(moveScene(s, 0, 2)!);
    expect(shape(down)).toEqual(['INT. B - DAY', 'b1', 'b2', 'INT. C - DAY', 'c1', 'INT. A - DAY', 'a1']);
    const up = s.apply(moveScene(s, 2, 0)!);
    expect(shape(up)).toEqual(['INT. C - DAY', 'c1', 'INT. A - DAY', 'a1', 'INT. B - DAY', 'b1', 'b2']);
    const mid = s.apply(moveScene(s, 2, 1)!);
    expect(shape(mid)).toEqual(['INT. A - DAY', 'a1', 'INT. C - DAY', 'c1', 'INT. B - DAY', 'b1', 'b2']);
    expect(moveScene(s, 1, 1)).toBeNull();
  });
});

describe('renameCharacter', () => {
  it('renames cues and mentions as whole words, keeping case style', () => {
    const s = make([
      ['character', 'BOB'],
      ['dialogue', 'Hi Bob, Bobby and bob.'],
      ['character', 'BOB (V.O.)'],
      ['action', "BOB'S car. Bob's hat."],
    ]);
    const next = s.apply(renameCharacter(s, 'Bob', 'Raymond')!);
    expect(shape(next)).toEqual(['RAYMOND', 'Hi Raymond, Bobby and Raymond.', 'RAYMOND (V.O.)', "RAYMOND'S car. Raymond's hat."]);
    expect(renameCharacter(s, 'Zed', 'X')).toBeNull();
  });
});
