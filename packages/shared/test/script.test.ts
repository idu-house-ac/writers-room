import { describe, expect, it } from 'vitest';
import { characterName, extractCharacters, extractLocations, extractScenes, parseSceneHeading } from '../src/format/script';

describe('script helpers', () => {
  it('parses scene headings', () => {
    expect(parseSceneHeading('INT. KITCHEN - NIGHT')).toEqual({ prefix: 'INT.', location: 'KITCHEN', time: 'NIGHT' });
    expect(parseSceneHeading('ext. beach – later')).toEqual({ prefix: 'EXT.', location: 'beach', time: 'later' });
    expect(parseSceneHeading('INT./EXT. CAR - CONTINUOUS')).toEqual({ prefix: 'INT./EXT.', location: 'CAR', time: 'CONTINUOUS' });
    expect(parseSceneHeading('I/E TRAIN')).toEqual({ prefix: 'I/E', location: 'TRAIN', time: '' });
  });
  it('strips extensions from character names', () => {
    expect(characterName("BOB (V.O.)")).toBe('BOB');
    expect(characterName("ANNA (CONT'D)")).toBe('ANNA');
    expect(characterName('MRS. PARK')).toBe('MRS. PARK');
  });
  it('builds scene, character and location lists', () => {
    const blocks = [
      { type: 'sceneHeading' as const, text: 'INT. KITCHEN - DAY' },
      { type: 'character' as const, text: 'ANNA' },
      { type: 'dialogue' as const, text: 'Hi.' },
      { type: 'character' as const, text: 'Bob (V.O.)' },
      { type: 'dialogue' as const, text: 'Hey.' },
      { type: 'sceneHeading' as const, text: 'INT. KITCHEN - NIGHT' },
      { type: 'character' as const, text: 'ANNA' },
      { type: 'dialogue' as const, text: 'Still here.' },
    ];
    expect(extractScenes(blocks)).toEqual([
      { block: 0, number: 1, heading: 'INT. KITCHEN - DAY' },
      { block: 5, number: 2, heading: 'INT. KITCHEN - NIGHT' },
    ]);
    expect(extractCharacters(blocks)).toEqual([
      { name: 'ANNA', cues: 2 },
      { name: 'BOB', cues: 1 },
    ]);
    expect(extractLocations(blocks)).toEqual([{ location: 'KITCHEN', scenes: 2 }]);
  });
});
