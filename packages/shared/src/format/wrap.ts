export interface WrappedLine {
  text: string;
  /** Character offsets into the source text; `end` is exclusive and includes trailing spaces. */
  start: number;
  end: number;
}

/**
 * Greedy word wrap that mirrors how browsers wrap `white-space: pre-wrap` text in a monospaced column:
 * breaks at spaces (trailing spaces hang past the right edge) and after a hyphen between letters or
 * digits; a single word longer than the column is broken at the column width. Returns at least one line.
 */
export function wrapText(text: string, width: number): WrappedLine[] {
  if (width < 1) width = 1;
  const n = text.length;
  const lines: WrappedLine[] = [];
  let lineStart = 0;

  while (lineStart < n) {
    let i = lineStart;
    let lastBreak = -1;
    while (i < n) {
      if (text[i] === ' ') {
        let j = i;
        while (j < n && text[j] === ' ') j++;
        lastBreak = j; // the next word may start a new line here
        i = j;
        continue;
      }
      if (i - lineStart + 1 > width) break; // this character would overflow
      if (text[i] === '-' && i > lineStart && i + 1 < n && /[A-Za-z0-9]/.test(text[i - 1]!) && /[A-Za-z0-9]/.test(text[i + 1]!)) {
        lastBreak = i + 1;
      }
      i++;
    }
    let end: number;
    if (i >= n) end = n;
    else if (lastBreak > lineStart) end = lastBreak;
    else end = lineStart + width; // hard break inside an over-long word
    lines.push({ text: text.slice(lineStart, end).replace(/ +$/, ''), start: lineStart, end });
    lineStart = end;
  }
  if (lines.length === 0) lines.push({ text: '', start: 0, end: 0 });
  return lines;
}
