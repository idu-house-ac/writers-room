import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';

/** Re-render on editor transactions, coalesced to one render per animation frame. */
export function useEditorTick(editor: Editor | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let frame: number | null = null;
    const bump = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setTick((t) => t + 1);
      });
    };
    editor.on('transaction', bump);
    editor.on('focus', bump);
    editor.on('blur', bump);
    return () => {
      editor.off('transaction', bump);
      editor.off('focus', bump);
      editor.off('blur', bump);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor]);
  return tick;
}
