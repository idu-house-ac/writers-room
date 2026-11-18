import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import { Link } from 'react-router';
import { can, FORMAT_LABELS, getProfile, ROLE_LABELS, type ProjectDetail } from '@writers-room/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/Avatar';
import { Menu } from '../components/Menu';
import { ShareDialog } from '../components/ShareDialog';
import { Wordmark } from '../components/Wordmark';
import { applyTheme, loadTheme, type Theme } from '../lib/theme';
import { baseExtensions } from './elements';
import { EditorPlugins } from './extensions';
import { FindBar } from './FindBar';
import { paginationKey, setViewMode, type ViewMode } from './pagination';
import { profileCss } from './pageStyles';
import { ScreenplayKit } from './ScreenplayKit';
import { SCRIPT_FIELD, type ScriptDoc } from './scriptDoc';
import { Sidebar } from './Sidebar';
import { SmartType } from './smartType';
import { Toolbar } from './Toolbar';
import { useEditorTick } from './useEditorTick';
import { docBlocks } from './blocks';
import './editor.css';

const STATUS_LABEL: Record<ScriptDoc['status'], string> = {
  loading: 'Loading',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed, retrying',
  readonly: 'Read only',
};

export function EditorScreen({ project, doc, onProjectChange }: { project: ProjectDetail; doc: ScriptDoc; onProjectChange: (p: ProjectDetail) => void }) {
  const { user, signOut } = useAuth();
  const profile = useMemo(() => getProfile(project.formatProfile), [project.formatProfile]);
  const canEdit = can(project.myRole, 'edit');
  const [mode, setModeState] = useState<ViewMode>('page');
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState(doc.status);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => doc.subscribe(() => setSaveStatus(doc.status)), [doc]);

  const editor = useEditor(
    {
      extensions: [
        ...baseExtensions,
        Collaboration.configure({ document: doc.ydoc, field: SCRIPT_FIELD }),
        ScreenplayKit.configure({ profile }),
        SmartType.configure({ profile }),
        EditorPlugins.configure({ profile, mode: 'page' }),
      ],
      editable: canEdit,
      autofocus: canEdit ? 'end' : false,
      editorProps: { attributes: { class: 'paper', spellcheck: 'true', 'aria-label': 'Script' } },
    },
    [doc, profile, canEdit],
  );
  const tick = useEditorTick(editor);
  void tick;

  const setMode = useCallback(
    (m: ViewMode) => {
      setModeState(m);
      if (editor) editor.view.dispatch(setViewMode(editor.state.tr, m));
    },
    [editor],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === 'Escape') {
        if (findOpen) setFindOpen(false);
        else if (focus) setFocus(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [findOpen, focus]);

  const pagination = editor ? paginationKey.getState(editor.state)?.result : undefined;
  const blocks = editor ? docBlocks(editor.state.doc).blocks : [];
  const hasText = blocks.some((b) => b.text.trim() !== '');
  const pageCount = hasText && pagination ? pagination.pages.length : 0;
  const sceneCount = blocks.filter((b) => b.type === 'sceneHeading').length;

  async function saveTitle() {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === project.title) return;
    try {
      const r = await api<{ project: Omit<ProjectDetail, 'invites'> }>(`/projects/${project.id}`, { method: 'PATCH', body: { title: next } });
      onProjectChange({ ...r.project, invites: project.invites });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const statusDot = saveStatus === 'saved' ? '' : saveStatus === 'error' ? 'bad' : saveStatus === 'readonly' ? 'off' : 'busy';

  return (
    <div className={`editor-screen${focus ? ' focus-mode' : ''}${mode === 'draft' ? ' draft-mode' : ''}`}>
      <style>{profileCss(profile)}</style>
      <header className="project-head">
        <Wordmark />
        <span className="faint">/</span>
        {renaming ? (
          <input
            className="input"
            style={{ maxWidth: 360 }}
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') setRenaming(false);
            }}
            aria-label="Project title"
          />
        ) : (
          <h1
            className="truncate"
            title={canEdit ? 'Click to rename' : undefined}
            style={{ cursor: canEdit ? 'text' : 'default' }}
            onClick={() => {
              if (!canEdit) return;
              setTitle(project.title);
              setRenaming(true);
            }}
          >
            {project.title}
          </h1>
        )}
        <span className="badge badge-accent">{FORMAT_LABELS[project.formatProfile]}</span>
        <span className="badge">{ROLE_LABELS[project.myRole]}</span>
        {error && <span className="error">{error}</span>}
        <div className="grow" />
        <div className="avatar-stack">
          {project.members.map((m) => (
            <Avatar key={m.id} user={m} title={`${m.name} · ${ROLE_LABELS[m.role]}`} />
          ))}
        </div>
        <button className="btn" onClick={() => setSharing(true)}>
          Share
        </button>
        {user && (
          <Menu label="Account menu">
            {(close) => (
              <>
                <button role="menuitem" disabled>
                  {user.email}
                </button>
                <Link to="/" role="menuitem" className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }}>
                  All projects
                </Link>
                <button
                  role="menuitem"
                  onClick={async () => {
                    close();
                    await doc.flush();
                    await signOut();
                  }}
                >
                  Sign out
                </button>
              </>
            )}
          </Menu>
        )}
      </header>

      <div>
        <Toolbar
          editor={editor}
          profile={profile}
          canEdit={canEdit}
          mode={mode}
          onMode={setMode}
          zoom={zoom}
          onZoom={setZoom}
          onFind={() => setFindOpen(true)}
          onFocus={() => setFocus(true)}
          theme={theme}
          onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        {findOpen && <FindBar editor={editor} canEdit={canEdit} onClose={() => setFindOpen(false)} />}
      </div>

      <div className="editor-body">
        <Sidebar editor={editor} canEdit={canEdit} />
        <div className="paper-scroll" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus()}>
          <div className="paper-wrap" style={{ ['--zoom' as string]: zoom }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <footer className="statusbar">
        <span>
          <span className={`dot ${statusDot}`} aria-hidden="true" />
          {STATUS_LABEL[saveStatus]}
        </span>
        <span>
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </span>
        <span>
          {sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'}
        </span>
        <span title="About one page per minute of screen time">≈ {pageCount} min (estimate)</span>
        <div className="grow" />
        {focus && <span>Esc leaves focus mode</span>}
        <span>Enter and Tab move between elements · {mode === 'page' ? 'Page view' : 'Draft view'}</span>
      </footer>

      {sharing && <ShareDialog project={project} onClose={() => setSharing(false)} onChange={onProjectChange} />}
    </div>
  );
}
