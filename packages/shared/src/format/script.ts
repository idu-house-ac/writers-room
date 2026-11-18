import type { ScriptBlock } from './pagination';

export interface SceneInfo {
  /** Index of the scene heading block. */
  block: number;
  number: number;
  heading: string;
}

export function extractScenes(blocks: ScriptBlock[]): SceneInfo[] {
  const scenes: SceneInfo[] = [];
  blocks.forEach((b, i) => {
    if (b.type === 'sceneHeading') scenes.push({ block: i, number: scenes.length + 1, heading: b.text });
  });
  return scenes;
}

export const SCENE_PREFIX = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.|EXT\.|I\/E\.?|EST\.)\s*/i;
export const TIMES_OF_DAY = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MORNING', 'EVENING', 'AFTERNOON', 'DAWN', 'DUSK', 'SAME TIME', 'MOMENTS LATER'];
export const EXTENSIONS = ["(V.O.)", "(O.S.)", "(O.C.)", "(CONT'D)"];

export interface ParsedHeading {
  prefix: string;
  location: string;
  time: string;
}

/** "INT. KITCHEN - NIGHT" → { prefix: "INT.", location: "KITCHEN", time: "NIGHT" } */
export function parseSceneHeading(text: string): ParsedHeading {
  const m = text.match(SCENE_PREFIX);
  const prefix = m ? m[1]!.toUpperCase() : '';
  const rest = m ? text.slice(m[0].length) : text;
  const parts = rest.split(/\s+[-–—]\s+/);
  const location = (parts[0] ?? '').trim();
  const time = parts.length > 1 ? parts[parts.length - 1]!.trim() : '';
  return { prefix, location, time };
}

/** Character name without its extension: "BOB (V.O.)" → "BOB". */
export function characterName(cueText: string): string {
  return cueText.replace(/\s*\(.*?\)\s*$/, '').trim();
}

export function extractCharacters(blocks: ScriptBlock[]): { name: string; cues: number }[] {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    if (b.type !== 'character') continue;
    const name = characterName(b.text).toUpperCase();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, cues]) => ({ name, cues })).sort((a, b) => b.cues - a.cues || a.name.localeCompare(b.name));
}

export function extractLocations(blocks: ScriptBlock[]): { location: string; scenes: number }[] {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    if (b.type !== 'sceneHeading') continue;
    const { location } = parseSceneHeading(b.text);
    const key = location.toUpperCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([location, scenes]) => ({ location, scenes })).sort((a, b) => b.scenes - a.scenes || a.location.localeCompare(b.location));
}

/** Plain-text rendering of a script, one block per paragraph. Used by tests and the text export (M6). */
export function blocksToText(blocks: ScriptBlock[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}
