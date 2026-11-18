// Read the ProseMirror document as plain script blocks (for pagination, the navigator and lists).
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { extractScenes, type ScriptBlock } from '@writers-room/shared';
import { isElementType } from './elements';

export interface DocBlocks {
  blocks: ScriptBlock[];
  /** Position before each block node, parallel to `blocks`. */
  positions: number[];
  /** Node of each block. */
  nodes: PmNode[];
}

const cache = new WeakMap<PmNode, DocBlocks>();

export function docBlocks(doc: PmNode): DocBlocks {
  let hit = cache.get(doc);
  if (hit) return hit;
  const blocks: ScriptBlock[] = [];
  const positions: number[] = [];
  const nodes: PmNode[] = [];
  doc.forEach((node, offset) => {
    if (!isElementType(node.type.name)) return;
    blocks.push({ type: node.type.name, text: node.textContent });
    positions.push(offset);
    nodes.push(node);
  });
  hit = { blocks, positions, nodes };
  cache.set(doc, hit);
  return hit;
}

/** Scene ranges in document positions: [start of heading, end of last block of the scene). */
export function sceneRanges(doc: PmNode): { number: number; heading: string; from: number; to: number; block: number }[] {
  const { blocks, positions, nodes } = docBlocks(doc);
  const scenes = extractScenes(blocks);
  return scenes.map((s, i) => {
    const next = scenes[i + 1];
    const lastBlock = next ? next.block - 1 : blocks.length - 1;
    return { number: s.number, heading: s.heading, block: s.block, from: positions[s.block]!, to: positions[lastBlock]! + nodes[lastBlock]!.nodeSize };
  });
}

/** Move scene `from` so that it sits at index `to` in the scene order. */
export function moveScene(state: EditorState, from: number, to: number): Transaction | null {
  const scenes = sceneRanges(state.doc);
  const src = scenes[from];
  const dst = scenes[to];
  if (!src || !dst || from === to) return null;
  const slice = state.doc.slice(src.from, src.to);
  const target = to > from ? dst.to : dst.from;
  const tr = state.tr.delete(src.from, src.to);
  tr.insert(tr.mapping.map(target, to > from ? -1 : 1), slice.content);
  return tr;
}

/** Replace a character name everywhere (cues and mentions), whole word, case-insensitive. */
export function renameCharacter(state: EditorState, oldName: string, newName: string): Transaction | null {
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`, 'gi');
  const tr = state.tr;
  const edits: { from: number; to: number; text: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(re)) {
      const upper = m[0] === m[0].toUpperCase();
      edits.push({ from: pos + m.index!, to: pos + m.index! + m[0].length, text: upper ? newName.toUpperCase() : newName });
    }
  });
  if (!edits.length) return null;
  for (const e of edits.reverse()) tr.insertText(e.text, e.from, e.to);
  return tr;
}
