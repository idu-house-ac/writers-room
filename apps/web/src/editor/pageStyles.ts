// Turns a format profile into the CSS the page view needs. Nothing about indents or page size is
// written in a stylesheet by hand; this is the only place that knows the numbers, and it reads them
// from the profile.
import { ELEMENT_TYPES, type FormatProfile } from '@writers-room/shared';

export function profileCss(profile: FormatProfile): string {
  const p = profile.page;
  const lines: string[] = [];
  lines.push(`.paper {
  --page-width: ${p.widthIn}in; --page-height: ${p.heightIn}in; --page-top: ${p.topIn}in; --page-bottom: ${p.bottomIn}in;
  --page-left: ${p.leftIn}in; --page-right: ${p.rightIn}in; --page-number-top: ${p.pageNumberTopIn}in;
  --line: calc(1in / ${p.linesPerInch}); --char: calc(1in / ${p.charsPerInch});
  font-size: ${p.fontSizePt}pt; line-height: var(--line);
  width: var(--page-width); padding: var(--page-top) 0 var(--page-bottom);
}`);
  for (const type of ELEMENT_TYPES) {
    const r = profile.elements[type];
    lines.push(`.paper .el-${type} { margin-left: ${r.leftIn}in; width: ${r.widthIn}in; text-align: ${r.align}; margin-top: calc(${r.blankLinesBefore} * var(--line)); }`);
    // Page gaps inside a block must span the full paper width; CONT'D cues sit at the character indent.
    lines.push(`.paper .el-${type} .pb-gap { margin-left: ${-r.leftIn}in; width: var(--page-width); }`);
    lines.push(`.paper .el-${type} .pb-contd { margin-left: ${profile.elements.character.leftIn - r.leftIn}in; width: ${profile.elements.character.widthIn}in; }`);
  }
  lines.push(`.paper .el:first-child, .paper .el.page-start { margin-top: 0; }`);
  return lines.join('\n');
}
