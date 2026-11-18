// The one pagination engine. The page view, the page count and (from M6) the PDF all call this.
import { columnChars, linesPerPage, type ElementType, type FormatProfile } from './elements';
import { wrapText, type WrappedLine } from './wrap';

export interface ScriptBlock {
  type: ElementType;
  text: string;
}

export interface PageEntry {
  /** Index into the blocks array. */
  block: number;
  type: ElementType;
  /** Wrapped lines of this block that appear on this page. */
  lines: WrappedLine[];
  /** First and last (exclusive) line index of the block shown here. */
  lineFrom: number;
  lineTo: number;
  /** Character range of the block's text shown on this page. */
  charFrom: number;
  charTo: number;
  /** Blank lines above this entry on the page (0 at the top of a page). */
  blankBefore: number;
  /** For a continued dialogue: the "NAME (CONT'D)" cue printed above it. */
  contdCue?: string;
  /** For a dialogue that continues on the next page: print "(MORE)" below. */
  more?: boolean;
}

export interface Page {
  number: number;
  entries: PageEntry[];
  usedLines: number;
}

export interface PaginationResult {
  pages: Page[];
  /** Page number (1-based) on which each block starts. */
  pageOfBlock: number[];
  linesPerPage: number;
}

interface Measured {
  index: number;
  type: ElementType;
  lines: WrappedLine[];
  blankBefore: number;
}

function measure(blocks: ScriptBlock[], profile: FormatProfile, cache?: Map<string, WrappedLine[]>): Measured[] {
  return blocks.map((b, index) => {
    const rule = profile.elements[b.type];
    const key = cache ? `${b.type}\u0000${b.text}` : '';
    let lines = cache?.get(key);
    if (!lines) {
      lines = wrapText(b.text, columnChars(profile, b.type));
      cache?.set(key, lines);
    }
    return { index, type: b.type, lines, blankBefore: rule.blankLinesBefore };
  });
}

/** Does this wrapped line end a sentence? */
export function endsSentence(line: string): boolean {
  return /[.!?…]["')\]]*\s*$/.test(line);
}

/** Character name for a CONT'D cue: the nearest character block above a dialogue, without its extension. */
function cueFor(blocks: ScriptBlock[], dialogueIndex: number): string {
  for (let i = dialogueIndex - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.type === 'character') return b.text.replace(/\s*\(.*?\)\s*$/, '').trim();
    if (b.type !== 'parenthetical') break;
  }
  return '';
}

/**
 * Paginate script blocks.
 *
 * Rules (BRIEF.md): never end a page with a scene heading, character cue or parenthetical; dialogue
 * splits only at a sentence boundary with (MORE) and NAME (CONT'D); transitions stay with the content
 * above them; action splits anywhere but never leaves fewer than `minSplitLines` lines on a side.
 */
export function paginate(blocks: ScriptBlock[], profile: FormatProfile, cache?: Map<string, WrappedLine[]>): PaginationResult {
  const capacity = linesPerPage(profile);
  const measured = measure(blocks, profile, cache);
  const pages: Page[] = [];
  const pageOfBlock: number[] = new Array(blocks.length).fill(1);

  let page: Page = { number: 1, entries: [], usedLines: 0 };
  const newPage = () => {
    pages.push(page);
    page = { number: pages.length + 1, entries: [], usedLines: 0 };
  };
  const remaining = () => capacity - page.usedLines;
  const atTop = () => page.entries.length === 0;

  // Groups: a run of keep-with-next blocks plus the block after them, plus any keep-with-previous
  // blocks (transitions) that follow.
  const groups: Measured[][] = [];
  for (const m of measured) {
    const rule = profile.elements[m.type];
    const last = groups[groups.length - 1];
    if (last && (rule.keepWithPrevious || profile.elements[last[last.length - 1]!.type].keepWithNext)) {
      last.push(m);
    } else {
      groups.push([m]);
    }
  }

  const cost = (m: Measured, first: boolean) => (first ? 0 : m.blankBefore) + m.lines.length;

  const pushWhole = (m: Measured) => {
    const first = atTop();
    const blank = first ? 0 : m.blankBefore;
    page.entries.push({
      block: m.index,
      type: m.type,
      lines: m.lines,
      lineFrom: 0,
      lineTo: m.lines.length,
      charFrom: 0,
      charTo: m.lines[m.lines.length - 1]?.end ?? 0,
      blankBefore: blank,
    });
    page.usedLines += blank + m.lines.length;
    pageOfBlock[m.index] = page.number;
  };

  /** Place part of a splittable block: lines [0, upto) now, the rest as a new Measured for later. */
  const pushHead = (m: Measured, upto: number, more: boolean): Measured => {
    const first = atTop();
    const blank = first ? 0 : m.blankBefore;
    const head = m.lines.slice(0, upto);
    page.entries.push({
      block: m.index,
      type: m.type,
      lines: head,
      lineFrom: 0,
      lineTo: upto,
      charFrom: 0,
      charTo: head[head.length - 1]!.end,
      blankBefore: blank,
      more: more || undefined,
    });
    page.usedLines += blank + upto + (more ? 1 : 0);
    pageOfBlock[m.index] = page.number;
    return { ...m, lines: m.lines.slice(upto) };
  };

  // When a tail of a block continues on a new page we carry its original line offset.
  const pushTail = (m: Measured, lineOffset: number, contdCue?: string) => {
    const blank = atTop() ? 0 : m.blankBefore;
    page.entries.push({
      block: m.index,
      type: m.type,
      lines: m.lines,
      lineFrom: lineOffset,
      lineTo: lineOffset + m.lines.length,
      charFrom: m.lines[0]!.start,
      charTo: m.lines[m.lines.length - 1]!.end,
      blankBefore: blank,
      contdCue,
    });
    page.usedLines += blank + m.lines.length + (contdCue ? 1 : 0);
  };

  for (const group of groups) {
    // Split the group into head (keep-with-next run), body (the splittable or plain block), tail (transitions).
    let bodyAt = 0;
    while (bodyAt < group.length - 1 && profile.elements[group[bodyAt]!.type].keepWithNext) bodyAt++;
    const head = group.slice(0, bodyAt);
    const body = group[bodyAt]!;
    const tail = group.slice(bodyAt + 1); // keep-with-previous blocks (transitions)

    const headCost = head.reduce((sum, m, i) => sum + cost(m, atTop() && i === 0), 0);
    const tailCost = tail.reduce((sum, m) => sum + cost(m, false), 0);
    const bodyRule = profile.elements[body.type];
    const totalCost = headCost + cost(body, atTop() && head.length === 0) + tailCost;

    if (totalCost <= remaining()) {
      for (const m of group) pushWhole(m);
      continue;
    }

    // Does not fit. Can the body be split so that the head and the first part stay here?
    const bodyFirst = atTop() && head.length === 0;
    const available = remaining() - headCost - (bodyFirst ? 0 : body.blankBefore);
    const minLines = profile.minSplitLines;
    let placed = false;

    if (bodyRule.splittable !== 'none' && body.lines.length >= 2 * minLines) {
      // Upper bound for lines on this page: leave at least minLines for the next page, and when a
      // transition follows the remainder must carry it, so there must be a remainder at all.
      const moreCost = bodyRule.splittable === 'sentence' ? 1 : 0;
      let upto = Math.min(available - moreCost, body.lines.length - minLines);
      if (bodyRule.splittable === 'sentence') {
        while (upto >= minLines && !endsSentence(body.lines[upto - 1]!.text)) upto--;
      }
      if (upto >= minLines) {
        for (const m of head) pushWhole(m);
        const rest = pushHead(body, upto, bodyRule.splittable === 'sentence');
        newPage();
        const cue = bodyRule.splittable === 'sentence' ? `${cueFor(blocks, body.index)} ${profile.continuation.contd}`.trim() : undefined;
        // Continue the remainder, possibly across several more pages.
        let remainder = rest;
        let offset = upto;
        for (;;) {
          const restCost = remainder.lines.length + (cue ? 1 : 0);
          if (restCost + tailCost <= remaining()) {
            pushTail(remainder, offset, cue);
            for (const m of tail) pushWhole(m);
            break;
          }
          const room = remaining() - (cue ? 1 : 0) - moreCost;
          let cut = Math.min(room, remainder.lines.length - minLines);
          if (bodyRule.splittable === 'sentence') {
            while (cut >= minLines && !endsSentence(remainder.lines[cut - 1]!.text)) cut--;
          }
          if (cut < minLines) {
            // Cannot split again sensibly: put the remainder here and let the tail start the next page.
            pushTail(remainder, offset, cue);
            newPage();
            for (const m of tail) pushWhole(m);
            break;
          }
          const headLines = remainder.lines.slice(0, cut);
          page.entries.push({
            block: body.index,
            type: body.type,
            lines: headLines,
            lineFrom: offset,
            lineTo: offset + cut,
            charFrom: headLines[0]!.start,
            charTo: headLines[cut - 1]!.end,
            blankBefore: 0,
            contdCue: cue,
            more: bodyRule.splittable === 'sentence' || undefined,
          });
          page.usedLines += cut + (cue ? 1 : 0) + moreCost;
          remainder = { ...remainder, lines: remainder.lines.slice(cut) };
          offset += cut;
          newPage();
        }
        placed = true;
      }
    }

    if (placed) continue;

    // Move the whole group to a fresh page (unless the page is already empty: then it simply does not
    // fit on any page and we place it anyway, letting it overflow in pieces).
    if (!atTop()) newPage();
    let overflowed = false;
    for (const m of group) {
      if (cost(m, atTop()) > remaining() && !atTop()) {
        newPage();
        overflowed = true;
      }
      pushWhole(m);
    }
    void overflowed;
  }

  pages.push(page);
  return { pages, pageOfBlock, linesPerPage: capacity };
}

/** Rough runtime: one page is about one minute of screen time. */
export function estimateRuntimeMinutes(pageCount: number): number {
  return pageCount;
}
