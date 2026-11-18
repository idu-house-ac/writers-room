import { describe, expect, it } from 'vitest';
import { FEATURE_PROFILE } from '../src/format/feature';
import { columnChars, linesPerPage } from '../src/format/elements';
import { paginate, type ScriptBlock } from '../src/format/pagination';

const P = FEATURE_PROFILE;
const CAP = linesPerPage(P); // 54
const block = (type: ScriptBlock['type'], text: string): ScriptBlock => ({ type, text });
/** An action paragraph that wraps to exactly n lines. */
const actionLines = (n: number) => block('action', Array.from({ length: n }, (_, i) => `Line ${String(i + 1).padStart(2, '0')} of action text that fills the column nicely yes.`).join(' '));
/** Dialogue of n full lines, every line a sentence. */
const dialogueLines = (n: number) => block('dialogue', Array.from({ length: n }, (_, i) => `Sentence number ${String(i + 1).padStart(2, '0')} here ok.`).join(' '));

describe('geometry', () => {
  it('derives 54 lines per page and column widths from the profile', () => {
    expect(CAP).toBe(54);
    expect(columnChars(P, 'action')).toBe(60);
    expect(columnChars(P, 'dialogue')).toBe(35);
    expect(columnChars(P, 'character')).toBe(30);
  });
  it('wraps the test fixtures to one line each', () => {
    expect(paginate([actionLines(3)], P).pages[0]!.entries[0]!.lines).toHaveLength(3);
    expect(paginate([dialogueLines(4)], P).pages[0]!.entries[0]!.lines).toHaveLength(4);
  });
});

describe('paginate', () => {
  it('fills a page and starts a new one', () => {
    const blocks = [block('sceneHeading', 'INT. ROOM - DAY'), actionLines(52), actionLines(10)];
    const r = paginate(blocks, P);
    // heading(1) + blank+52 = 54 exactly; next action on page 2
    expect(r.pages).toHaveLength(2);
    expect(r.pageOfBlock).toEqual([1, 1, 2]);
    expect(r.pages[0]!.usedLines).toBe(54);
    expect(r.pages[1]!.entries[0]!.blankBefore).toBe(0);
  });

  it('never ends a page with a scene heading', () => {
    const blocks = [actionLines(52), block('sceneHeading', 'INT. KITCHEN - NIGHT'), actionLines(5)];
    const r = paginate(blocks, P);
    expect(r.pageOfBlock).toEqual([1, 2, 2]);
    expect(r.pages[0]!.entries.map((e) => e.type)).toEqual(['action']);
  });

  it('never ends a page with a character cue or a parenthetical', () => {
    const blocks = [actionLines(51), block('character', 'ANNA'), block('parenthetical', '(quietly)'), dialogueLines(2)];
    // action 51 + blank + cue = 53, parenthetical would be 54: cue and parenthetical must not end the page
    const r = paginate(blocks, P);
    expect(r.pageOfBlock).toEqual([1, 2, 2, 2]);
    expect(r.pages[1]!.entries.map((e) => e.type)).toEqual(['character', 'parenthetical', 'dialogue']);
  });

  it('splits dialogue at a sentence boundary with (MORE) and NAME (CONT\'D)', () => {
    const blocks = [actionLines(45), block('character', 'BOB (V.O.)'), dialogueLines(12)];
    // 45 + blank + cue = 47; dialogue starts at line 48; room for 7 lines minus 1 for (MORE) = 6 lines
    const r = paginate(blocks, P);
    expect(r.pages).toHaveLength(2);
    const first = r.pages[0]!.entries.at(-1)!;
    expect(first.type).toBe('dialogue');
    expect(first.more).toBe(true);
    expect(first.lineTo).toBe(6);
    expect(r.pages[0]!.usedLines).toBe(54);
    const second = r.pages[1]!.entries[0]!;
    expect(second.contdCue).toBe("BOB (CONT'D)");
    expect(second.lineFrom).toBe(6);
    expect(second.lineTo).toBe(12);
    expect(second.charFrom).toBe(first.charTo);
    expect(r.pageOfBlock).toEqual([1, 1, 1]);
  });

  it('moves dialogue whole when no sentence boundary fits', () => {
    const longSentence = block('dialogue', Array.from({ length: 12 }, () => 'and on and on it goes').join(' ') + '.');
    const blocks = [actionLines(45), block('character', 'BOB'), longSentence];
    const r = paginate(blocks, P);
    expect(r.pageOfBlock).toEqual([1, 2, 2]);
    expect(r.pages[1]!.entries.map((e) => e.type)).toEqual(['character', 'dialogue']);
  });

  it('splits action anywhere but leaves at least two lines on each side', () => {
    const r = paginate([actionLines(50), actionLines(10)], P);
    // 50 + blank = 51, 3 lines of room → 3 lines here, 7 on the next page
    expect(r.pages[0]!.entries[1]!.lineTo).toBe(3);
    expect(r.pages[1]!.entries[0]!.lineFrom).toBe(3);
    expect(r.pages[1]!.entries[0]!.contdCue).toBeUndefined();

    const r2 = paginate([actionLines(52), actionLines(10)], P);
    // only 1 line of room → do not orphan a single line
    expect(r2.pageOfBlock).toEqual([1, 2]);
  });

  it('keeps a transition with the content above it', () => {
    const blocks = [actionLines(53), block('transition', 'CUT TO:'), block('sceneHeading', 'EXT. STREET - DAY')];
    // transition needs blank + 1 = 2 lines; only 1 left → split the action so 2 lines go with the transition
    const r = paginate(blocks, P);
    expect(r.pages[1]!.entries[0]!.type).toBe('action');
    expect(r.pages[1]!.entries[1]!.type).toBe('transition');
    expect(r.pages[0]!.entries[0]!.lineTo).toBe(51);
  });

  it('numbers pages and reports page of block for a long script', () => {
    const blocks: ScriptBlock[] = [];
    for (let s = 0; s < 40; s++) {
      blocks.push(block('sceneHeading', `INT. PLACE ${s} - DAY`), actionLines(4), block('character', 'ANNA'), dialogueLines(3), block('character', 'BOB'), dialogueLines(2), actionLines(6));
    }
    const r = paginate(blocks, P);
    expect(r.pages.length).toBeGreaterThan(10);
    r.pages.forEach((p, i) => {
      expect(p.number).toBe(i + 1);
      expect(p.usedLines).toBeLessThanOrEqual(CAP);
      expect(p.entries[0]!.blankBefore).toBe(0);
      expect(['sceneHeading', 'character', 'parenthetical']).not.toContain(p.entries.at(-1)!.type);
      expect(p.entries[0]!.type).not.toBe('transition');
    });
    expect(r.pageOfBlock.length).toBe(blocks.length);
  });

  it('is fast enough for a 120-page script', () => {
    const blocks: ScriptBlock[] = [];
    while (blocks.length < 3000) {
      blocks.push(block('sceneHeading', 'INT. PLACE - DAY'), actionLines(3), block('character', 'ANNA'), dialogueLines(2), actionLines(2));
    }
    const cache = new Map();
    paginate(blocks, P, cache);
    const t = performance.now();
    const r = paginate(blocks, P, cache);
    const ms = performance.now() - t;
    expect(r.pages.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(200);
  });
});
