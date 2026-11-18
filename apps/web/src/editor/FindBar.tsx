import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { replaceAll, replaceCurrent, searchKey, setSearch, stepSearch } from './search';

export function FindBar({ editor, canEdit, onClose }: { editor: Editor | null; canEdit: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    return () => {
      if (editor && !editor.isDestroyed) editor.view.dispatch(setSearch(editor.state.tr, ''));
    };
  }, [editor]);

  const st = editor ? searchKey.getState(editor.state) : undefined;
  const total = st?.matches.length ?? 0;

  const update = (q: string) => {
    setQuery(q);
    if (editor) editor.view.dispatch(setSearch(editor.state.tr, q));
  };
  const step = (n: number) => editor && editor.view.dispatch(stepSearch(editor.state, n));

  return (
    <div className="findbar" role="search">
      <input
        ref={input}
        className="input"
        placeholder="Find"
        value={query}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }
          if (e.key === 'Escape') onClose();
        }}
        aria-label="Find"
      />
      <span className="count" aria-live="polite">
        {query ? (total ? `${(st?.current ?? 0) + 1} of ${total}` : 'No matches') : ''}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => step(-1)} disabled={!total} aria-label="Previous match">
        ↑
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => step(1)} disabled={!total} aria-label="Next match">
        ↓
      </button>
      {canEdit && (
        <>
          <span className="sep" />
          <input className="input" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replace with" />
          <button
            className="btn btn-sm"
            disabled={!total}
            onClick={() => {
              if (!editor) return;
              const tr = replaceCurrent(editor.state, replacement);
              if (tr) editor.view.dispatch(tr);
            }}
          >
            Replace
          </button>
          <button
            className="btn btn-sm"
            disabled={!total}
            onClick={() => {
              if (!editor) return;
              const tr = replaceAll(editor.state, replacement);
              if (tr) editor.view.dispatch(tr);
            }}
          >
            Replace all
          </button>
        </>
      )}
      <div className="grow" />
      <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close find">
        ✕
      </button>
    </div>
  );
}
