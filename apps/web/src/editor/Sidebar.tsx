import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { extractCharacters, extractLocations } from '@writers-room/shared';
import { docBlocks, moveScene, renameCharacter, sceneRanges } from './blocks';
import { paginationKey } from './pagination';
import type { Collaborator } from './presence';
import { initials } from '../lib/time';

type Tab = 'scenes' | 'characters' | 'locations';

export function Sidebar({ editor, canEdit, people = [] }: { editor: Editor | null; canEdit: boolean; people?: Collaborator[] }) {
  const [tab, setTab] = useState<Tab>('scenes');
  const [drag, setDrag] = useState<{ from: number; over: number | null; after: boolean }>({ from: -1, over: null, after: false });

  if (!editor) return <aside className="sidebar" />;
  const { blocks } = docBlocks(editor.state.doc);
  const scenes = sceneRanges(editor.state.doc);
  const pagination = paginationKey.getState(editor.state)?.result;
  const cursor = editor.state.selection.from;
  const activeScene = scenes.findIndex((s, i) => cursor >= s.from && (i === scenes.length - 1 || cursor < scenes[i + 1]!.from));

  const jump = (pos: number) => {
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)).scrollIntoView();
    editor.view.dispatch(tr);
    editor.view.focus();
  };

  const drop = (to: number, after: boolean) => {
    const from = drag.from;
    setDrag({ from: -1, over: null, after: false });
    if (from < 0) return;
    let target = after ? to : to - 1;
    if (from < to) target = after ? to : to - 1;
    else target = after ? to + 1 : to;
    if (target === from) return;
    const tr = moveScene(editor.state, from, target);
    if (tr) editor.view.dispatch(tr.scrollIntoView());
  };

  return (
    <aside className="sidebar" aria-label="Script navigator">
      <div className="tabs" role="tablist">
        {(['scenes', 'characters', 'locations'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="list">
        {tab === 'scenes' &&
          (scenes.length === 0 ? (
            <p className="hint">No scenes yet. Type INT. or EXT. at the start of a line to begin one.</p>
          ) : (
            scenes.map((s, i) => (
              <div
                key={`${s.from}-${s.number}`}
                className={`scene-item${i === activeScene ? ' active' : ''}${drag.over === i ? (drag.after ? ' drop-after' : ' drop-before') : ''}`}
                onClick={() => jump(s.from)}
                draggable={canEdit}
                onDragStart={(e) => {
                  setDrag({ from: i, over: null, after: false });
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (drag.from < 0) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > rect.top + rect.height / 2;
                  if (drag.over !== i || drag.after !== after) setDrag({ ...drag, over: i, after });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(i, drag.after);
                }}
                onDragEnd={() => setDrag({ from: -1, over: null, after: false })}
                title={canEdit ? 'Click to jump, drag to reorder' : 'Click to jump'}
              >
                <span className="num">{s.number}</span>
                <span className="heading">
                  {s.heading || '(untitled scene)'}
                  {(() => {
                    const next = scenes[i + 1];
                    const here = people.filter((p) => p.pos !== null && p.pos >= s.from && (!next || p.pos < next.from));
                    if (!here.length) return null;
                    const seen = new Set<string>();
                    return (
                      <span className="dots" aria-label={`Here: ${here.map((p) => p.name).join(', ')}`}>
                        {here.filter((p) => !seen.has(p.id) && seen.add(p.id)).map((p) => (
                          <span key={p.id} className="dot" style={{ background: p.color }} title={`${p.name} (${initials(p.name)}) is in this scene`} />
                        ))}
                      </span>
                    );
                  })()}
                </span>
                <span className="pg">p. {pagination?.pageOfBlock[s.block] ?? '–'}</span>
              </div>
            ))
          ))}
        {tab === 'characters' &&
          (() => {
            const chars = extractCharacters(blocks);
            if (!chars.length) return <p className="hint">Characters appear here as you write character cues.</p>;
            return chars.map((c) => (
              <div className="list-row" key={c.name}>
                <span className="name">{c.name}</span>
                <span className="count">
                  {c.cues} {c.cues === 1 ? 'cue' : 'cues'}
                </span>
                {canEdit && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const next = prompt(`Rename ${c.name} everywhere in the script to:`, c.name);
                      if (!next || next.trim().toUpperCase() === c.name) return;
                      const tr = renameCharacter(editor.state, c.name, next.trim());
                      if (tr) editor.view.dispatch(tr);
                    }}
                  >
                    Rename
                  </button>
                )}
              </div>
            ));
          })()}
        {tab === 'locations' &&
          (() => {
            const locs = extractLocations(blocks);
            if (!locs.length) return <p className="hint">Locations are read from your scene headings.</p>;
            return locs.map((l) => (
              <div className="list-row" key={l.location}>
                <span className="name">{l.location}</span>
                <span className="count">
                  {l.scenes} {l.scenes === 1 ? 'scene' : 'scenes'}
                </span>
              </div>
            ));
          })()}
      </div>
    </aside>
  );
}
