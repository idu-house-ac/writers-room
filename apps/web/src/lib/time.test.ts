import { describe, expect, it } from 'vitest';
import { initials, timeAgo } from './time';

describe('timeAgo', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  it('rounds sensibly', () => {
    expect(timeAgo('2026-11-18T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-11-18T11:45:00Z', now)).toBe('15 min ago');
    expect(timeAgo('2026-11-18T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-11-16T12:00:00Z', now)).toBe('2 d ago');
  });
});

describe('initials', () => {
  it('uses first and last name', () => {
    expect(initials('Amadin Idu')).toBe('AI');
    expect(initials('aaron')).toBe('A');
    expect(initials('  ')).toBe('?');
  });
});
