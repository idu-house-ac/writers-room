// Relative positions must keep pointing at the same characters while text is inserted above them.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

describe('comment anchors', () => {
  it('survive 20 insertions above and edits around them', () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment('script');
    const line = (text: string) => {
      const el = new Y.XmlElement('action');
      el.insert(0, [new Y.XmlText(text)]);
      return el;
    };
    frag.insert(0, [line('INT. KITCHEN - DAY'), line('Anna pours coffee. The pot is empty.')]);
    const target = (frag.get(1) as Y.XmlElement).get(0) as Y.XmlText;
    const start = target.toString().indexOf('pours coffee');
    const relStart = Y.createRelativePositionFromTypeIndex(target, start);
    const relEnd = Y.createRelativePositionFromTypeIndex(target, start + 'pours coffee'.length);
    // stored as base64, like the server keeps them
    const storedStart = b64(Y.encodeRelativePosition(relStart));
    const storedEnd = b64(Y.encodeRelativePosition(relEnd));

    for (let i = 0; i < 20; i++) frag.insert(1, [line(`Inserted line ${i}`)]);
    target.insert(0, 'Early morning. ');
    target.insert(target.length, ' She sighs.');

    const a = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(unb64(storedStart)), doc)!;
    const b = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(unb64(storedEnd)), doc)!;
    expect(a.type).toBe(target);
    expect(target.toString().slice(a.index, b.index)).toBe('pours coffee');
    expect(frag.length).toBe(22);
  });

  it('report a deleted range as collapsed', () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, 'keep THIS keep');
    const s = Y.createRelativePositionFromTypeIndex(text, 5);
    const e = Y.createRelativePositionFromTypeIndex(text, 9);
    text.delete(5, 4);
    const a = Y.createAbsolutePositionFromRelativePosition(s, doc)!;
    const b = Y.createAbsolutePositionFromRelativePosition(e, doc)!;
    expect(a.index).toBe(b.index); // nothing left between the anchors → detached
  });
});
