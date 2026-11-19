import { describe, expect, it } from 'vitest';
import { diffScripts, diffWords, jsonToBlocks } from './diff';

const b = (type: string, text: string) => ({ type: type as 'action', text });

describe('diffWords', () => {
  it('marks removed and added words', () => {
    expect(diffWords('the cat sat', 'the dog sat down')).toEqual([
      { op: 'same', text: 'the ' },
      { op: 'del', text: 'cat' },
      { op: 'add', text: 'dog' },
      { op: 'same', text: ' sat' },
      { op: 'add', text: ' down' },
    ]);
  });
  it('handles identical and empty strings', () => {
    expect(diffWords('x', 'x')).toEqual([{ op: 'same', text: 'x' }]);
    expect(diffWords('', 'new')).toEqual([{ op: 'add', text: 'new' }]);
  });
});

describe('diffScripts', () => {
  it('aligns blocks and pairs replacements', () => {
    const old = [b('sceneHeading', 'INT. A - DAY'), b('action', 'One.'), b('action', 'Two.'), b('action', 'Three.')];
    const neu = [b('sceneHeading', 'INT. A - DAY'), b('action', 'One, changed.'), b('action', 'Three.'), b('action', 'Four.')];
    const d = diffScripts(old, neu);
    expect(d.map((x) => [x.op, x.newText || x.oldText])).toEqual([
      ['same', 'INT. A - DAY'],
      ['change', 'One, changed.'],
      ['del', 'Two.'],
      ['same', 'Three.'],
      ['add', 'Four.'],
    ]);
    expect(d[1]!.pieces).toEqual([{ op: 'del', text: 'One.' }, { op: 'add', text: 'One, changed.' }]);
  });
  it('treats a type change as remove + add', () => {
    const d = diffScripts([b('action', 'BOB')], [b('character', 'BOB')]);
    expect(d.map((x) => x.op)).toEqual(['del', 'add']);
  });
  it('reads snapshot JSON', () => {
    expect(jsonToBlocks({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there', marks: [{ type: 'bold' }] }] }] })).toEqual([{ type: 'action', text: 'Hi there' }]);
  });
});
