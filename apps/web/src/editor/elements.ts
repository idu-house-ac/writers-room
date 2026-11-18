// One Tiptap node type per screenplay element. The element's look (indent, width, case) comes from
// the format profile at render time (see pageStyles.ts), never from these node definitions.
import { Node, mergeAttributes, type Extensions } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import { ELEMENT_TYPES, type ElementType } from '@writers-room/shared';

const Document = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
});

const Text = Node.create({
  name: 'text',
  group: 'inline',
});

function elementNode(type: ElementType) {
  return Node.create({
    name: type,
    group: 'block',
    content: 'inline*',
    parseHTML() {
      return [{ tag: `p[data-element="${type}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['p', mergeAttributes(HTMLAttributes, { 'data-element': type, class: `el el-${type}` }), 0];
    },
  });
}

/** Action comes first so an empty document starts with an action line. */
const ORDER: ElementType[] = ['action', ...ELEMENT_TYPES.filter((t) => t !== 'action')];

export const elementNodes = ORDER.map(elementNode);

export function isElementType(name: string): name is ElementType {
  return (ELEMENT_TYPES as readonly string[]).includes(name);
}

export const baseExtensions: Extensions = [Document, Text, ...elementNodes, Bold, Italic, Underline];
