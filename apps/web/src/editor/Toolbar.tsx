import type { Editor } from '@tiptap/core';
import { ELEMENT_TYPES, type ElementType, type FormatProfile } from '@writers-room/shared';
import { currentBlock } from './commands';
import type { ViewMode } from './pagination';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function Toolbar(props: {
  editor: Editor | null;
  profile: FormatProfile;
  canEdit: boolean;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  zoom: number;
  onZoom: (z: number) => void;
  onFind: () => void;
  onFocus: () => void;
  theme: 'dark' | 'light';
  onTheme: () => void;
  canComment: boolean;
  onComment: () => void;
}) {
  const { editor, profile, canEdit } = props;
  const block = editor ? currentBlock(editor.state) : null;
  const type: ElementType | '' = block?.type ?? '';
  return (
    <div className="toolbar" role="toolbar" aria-label="Editor toolbar">
      <label className="sr-only" htmlFor="element-picker">
        Element
      </label>
      <select
        id="element-picker"
        className="select"
        value={type}
        disabled={!editor || !canEdit}
        onChange={(e) => editor?.chain().focus().setElement(e.target.value as ElementType).run()}
        title="Element of the current line"
      >
        {type === '' && <option value="">—</option>}
        {ELEMENT_TYPES.map((t, i) => (
          <option key={t} value={t}>
            {profile.elements[t].label}  ({MOD}+{i + 1})
          </option>
        ))}
      </select>
      <span className="sep" />
      <button className="btn btn-ghost btn-sm" disabled={!canEdit} onClick={() => editor?.chain().focus().undo().run()} title={`Undo (${MOD}+Z)`}>
        Undo
      </button>
      <button className="btn btn-ghost btn-sm" disabled={!canEdit} onClick={() => editor?.chain().focus().redo().run()} title={`Redo (${MOD}+Shift+Z)`}>
        Redo
      </button>
      <span className="sep" />
      <button className="btn btn-ghost btn-sm" disabled={!canEdit} aria-pressed={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} title={`Bold (${MOD}+B)`}>
        <b>B</b>
      </button>
      <button className="btn btn-ghost btn-sm" disabled={!canEdit} aria-pressed={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} title={`Italic (${MOD}+I)`}>
        <i>I</i>
      </button>
      <button className="btn btn-ghost btn-sm" disabled={!canEdit} aria-pressed={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()} title={`Underline (${MOD}+U)`}>
        <u>U</u>
      </button>
      <span className="sep" />
      <div className="seg" role="group" aria-label="View">
        <button aria-pressed={props.mode === 'page'} onClick={() => props.onMode('page')} title="Pages as printed">
          Page
        </button>
        <button aria-pressed={props.mode === 'draft'} onClick={() => props.onMode('draft')} title="Continuous, no page breaks">
          Draft
        </button>
      </div>
      <span className="sep" />
      <button className="btn btn-ghost btn-sm" onClick={() => props.onZoom(Math.max(0.6, Math.round((props.zoom - 0.1) * 10) / 10))} aria-label="Zoom out">
        −
      </button>
      <span className="small muted" style={{ minWidth: 40, textAlign: 'center' }}>
        {Math.round(props.zoom * 100)}%
      </span>
      <button className="btn btn-ghost btn-sm" onClick={() => props.onZoom(Math.min(1.6, Math.round((props.zoom + 0.1) * 10) / 10))} aria-label="Zoom in">
        +
      </button>
      <div className="grow" />
      <button className="btn btn-ghost btn-sm" disabled={!props.canComment || !editor || editor.state.selection.empty} onClick={props.onComment} title={`Comment on the selection (${MOD}+Alt+M)`}>
        Comment
      </button>
      <button className="btn btn-ghost btn-sm" onClick={props.onFind} title={`Find and replace (${MOD}+F)`}>
        Find
      </button>
      <button className="btn btn-ghost btn-sm" onClick={props.onTheme} title="Switch theme">
        {props.theme === 'dark' ? 'Light' : 'Dark'}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={props.onFocus} title="Focus mode (Esc to leave)">
        Focus
      </button>
    </div>
  );
}
