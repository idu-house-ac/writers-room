import { describe, expect, it } from 'vitest';
import { wrapText } from '../src/format/wrap';

const texts = (s: string, w: number) => wrapText(s, w).map((l) => l.text);

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(texts('Hello there.', 60)).toEqual(['Hello there.']);
    expect(texts('', 60)).toEqual(['']);
  });

  it('breaks at spaces and lets spaces hang past the edge', () => {
    expect(texts('one two three four', 8)).toEqual(['one two', 'three', 'four']);
    expect(texts('abcdefgh ijkl', 8)).toEqual(['abcdefgh', 'ijkl']);
    expect(texts('abcdefg ijkl', 8)).toEqual(['abcdefg', 'ijkl']);
  });

  it('breaks after a hyphen between letters', () => {
    expect(texts('mother-in-law arrives', 10)).toEqual(['mother-in-', 'law', 'arrives']);
  });

  it('hard-breaks a word longer than the column', () => {
    expect(texts('abcdefghijklmnop', 6)).toEqual(['abcdef', 'ghijkl', 'mnop']);
  });

  it('reports character offsets that tile the text', () => {
    const s = 'The quick brown fox jumps over the lazy dog, twice.';
    const lines = wrapText(s, 12);
    expect(lines[0]!.start).toBe(0);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.start).toBe(lines[i - 1]!.end);
    expect(lines[lines.length - 1]!.end).toBe(s.length);
    expect(lines.map((l) => s.slice(l.start, l.end).trimEnd())).toEqual(lines.map((l) => l.text));
  });

  it('never produces a line wider than the column, apart from hanging spaces', () => {
    const s = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.';
    for (const w of [5, 13, 35, 60]) {
      for (const l of texts(s, w)) expect(l.length).toBeLessThanOrEqual(w);
    }
  });
});
