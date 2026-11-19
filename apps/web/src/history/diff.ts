// Compare two versions of a script: block-level alignment, then word-level changes inside blocks that
// were replaced. Output is rendered with underline (added) and strikethrough (removed) as well as colour.
import type { ElementType, ScriptBlock, ScriptJson } from '@writers-room/shared';

export type Op = 'same' | 'add' | 'del';

export interface WordPiece {
  op: Op;
  text: string;
}

export interface DiffBlock {
  op: Op | 'change';
  type: ElementType;
  /** For 'change': the words with their ops. Otherwise the whole text. */
  pieces: WordPiece[];
  oldText: string;
  newText: string;
}

export function jsonToBlocks(json: ScriptJson): ScriptBlock[] {
  return (json.content ?? []).map((b) => ({ type: b.type as ElementType, text: (b.content ?? []).map((c) => c.text ?? '').join('') }));
}

function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): { keepA: boolean[]; keepB: boolean[] } {
  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = eq(a[i]!, b[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      keepA[i] = keepB[j] = true;
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return { keepA, keepB };
}

const words = (s: string) => s.split(/(\s+)/).filter((w) => w !== '');

/** Word-level diff of two strings. */
export function diffWords(oldText: string, newText: string): WordPiece[] {
  const a = words(oldText);
  const b = words(newText);
  const { keepA, keepB } = lcs(a, b, (x, y) => x === y);
  const out: WordPiece[] = [];
  const push = (op: Op, text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && !keepA[i]) push('del', a[i++]!);
    else if (j < b.length && !keepB[j]) push('add', b[j++]!);
    else {
      push('same', a[i]!);
      i++;
      j++;
    }
  }
  return out;
}

/** Block-level diff; runs of removed+added blocks are paired up and diffed word by word. */
export function diffScripts(oldBlocks: ScriptBlock[], newBlocks: ScriptBlock[]): DiffBlock[] {
  const { keepA, keepB } = lcs(oldBlocks, newBlocks, (x, y) => x.type === y.type && x.text === y.text);
  const out: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  while (i < oldBlocks.length || j < newBlocks.length) {
    if (i < oldBlocks.length && j < newBlocks.length && keepA[i] && keepB[j]) {
      const b = oldBlocks[i]!;
      out.push({ op: 'same', type: b.type, pieces: [{ op: 'same', text: b.text }], oldText: b.text, newText: b.text });
      i++;
      j++;
      continue;
    }
    // collect a run of changes on both sides
    const dels: ScriptBlock[] = [];
    const adds: ScriptBlock[] = [];
    while (i < oldBlocks.length && !keepA[i]) dels.push(oldBlocks[i++]!);
    while (j < newBlocks.length && !keepB[j]) adds.push(newBlocks[j++]!);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const o = dels[k]!;
      const n = adds[k]!;
      if (o.type === n.type) out.push({ op: 'change', type: n.type, pieces: diffWords(o.text, n.text), oldText: o.text, newText: n.text });
      else {
        out.push({ op: 'del', type: o.type, pieces: [{ op: 'del', text: o.text }], oldText: o.text, newText: '' });
        out.push({ op: 'add', type: n.type, pieces: [{ op: 'add', text: n.text }], oldText: '', newText: n.text });
      }
    }
    for (const o of dels.slice(pairs)) out.push({ op: 'del', type: o.type, pieces: [{ op: 'del', text: o.text }], oldText: o.text, newText: '' });
    for (const n of adds.slice(pairs)) out.push({ op: 'add', type: n.type, pieces: [{ op: 'add', text: n.text }], oldText: '', newText: n.text });
  }
  return out;
}

export function diffSummary(blocks: DiffBlock[]): { added: number; removed: number; changed: number } {
  return {
    added: blocks.filter((b) => b.op === 'add').length,
    removed: blocks.filter((b) => b.op === 'del').length,
    changed: blocks.filter((b) => b.op === 'change').length,
  };
}
