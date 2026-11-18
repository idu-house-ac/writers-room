// Screenplay elements and format profiles.
// Every number the page view, the PDF and the page count need comes from a profile object,
// never from CSS or export code (see BRIEF.md, "Screenplay formatting spec").

import type { FormatProfileId } from '../index';

/** Table order from the brief; Cmd/Ctrl+1..8 follow this order. */
export const ELEMENT_TYPES = [
  'sceneHeading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'centered',
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export type TextCase = 'upper' | 'lower' | 'asTyped';
export type Align = 'left' | 'right' | 'center';
/** How the pagination engine may split a block across pages. */
export type Splittable = 'none' | 'anywhere' | 'sentence';

export interface ElementRule {
  label: string;
  /** Distance from the left edge of the page to the element's left edge, inches. */
  leftIn: number;
  /** Width of the element's text column, inches. */
  widthIn: number;
  align: Align;
  textCase: TextCase;
  blankLinesBefore: number;
  enterTo: ElementType;
  tabTo: ElementType;
  /** Never let a page end with this element. */
  keepWithNext: boolean;
  /** Never let a page start with this element (transitions stay with the content above). */
  keepWithPrevious: boolean;
  splittable: Splittable;
}

export interface PageGeometry {
  widthIn: number;
  heightIn: number;
  topIn: number;
  bottomIn: number;
  leftIn: number;
  rightIn: number;
  charsPerInch: number;
  linesPerInch: number;
  fontSizePt: number;
  /** Page number position: baseline this far from the top edge, right-aligned to the right margin. */
  pageNumberTopIn: number;
}

export interface FormatProfile {
  id: FormatProfileId;
  name: string;
  page: PageGeometry;
  elements: Record<ElementType, ElementRule>;
  continuation: { more: string; contd: string };
  /** Smallest number of lines a split may leave on either side of a page break. */
  minSplitLines: number;
}

export function elementLabel(profile: FormatProfile, type: ElementType): string {
  return profile.elements[type].label;
}

export function applyTextCase(text: string, textCase: TextCase): string {
  if (textCase === 'upper') return text.toUpperCase();
  if (textCase === 'lower') return text.toLowerCase();
  return text;
}

/** Characters per line for an element, from its width and the page's pitch. */
export function columnChars(profile: FormatProfile, type: ElementType): number {
  return Math.round(profile.elements[type].widthIn * profile.page.charsPerInch);
}

/** Text lines that fit between the top and bottom margins. */
export function linesPerPage(profile: FormatProfile): number {
  const p = profile.page;
  return Math.round((p.heightIn - p.topIn - p.bottomIn) * p.linesPerInch);
}
