import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { can, type ProjectDetail, type SnapshotDetail, type SnapshotSummary } from '@writers-room/shared';
import { api, errorMessage } from '../api';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../lib/time';
import { docBlocks } from '../editor/blocks';
import { VersionDialog } from './VersionDialog';

export function HistoryPanel(props: { project: ProjectDetail; editor: Editor | null; onClose: () => void; refreshKey: number }) {
  const { project, editor } = props;
  const canName = can(project.myRole, 'name_draft');
  const canRestore = can(project.myRole, 'restore_version');
  const [snapshots, setSnapshots] = useState<SnapshotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compareA, setCompareA] = useState<SnapshotSummary | null>(null);
  const [dialog, setDialog] = useState<{ mode: 'preview'; a: SnapshotDetail } | { mode: 'compare'; a: SnapshotDetail | 'current'; b: SnapshotDetail | 'current' } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ snapshots: SnapshotSummary[] }>(`/projects/${project.id}/snapshots`);
      setSnapshots(r.snapshots);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  const fetchDetail = (id: string) => api<{ snapshot: SnapshotDetail }>(`/projects/${project.id}/snapshots/${id}`).then((r) => r.snapshot);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const nameDraft = () =>
    run(async () => {
      const r = await api<{ snapshots: SnapshotSummary[] }>(`/projects/${project.id}/snapshots`, { method: 'POST', body: { name: draftName } });
      setSnapshots(r.snapshots);
      setDraftName('');
      setNaming(false);
    });

  const restore = (s: SnapshotSummary) =>
    run(async () => {
      if (!confirm(`Restore ${label(s)}? The current text is saved to history first, and everyone in the project gets the restored version.`)) return;
      const r = await api<{ snapshots: SnapshotSummary[] }>(`/projects/${project.id}/snapshots/${s.id}/restore`, { method: 'POST' });
      setSnapshots(r.snapshots);
      setDialog(null);
    });

  const currentBlocks = () => (editor ? docBlocks(editor.state.doc).blocks : []);
  const named = (snapshots ?? []).filter((s) => s.kind === 'named');
  const auto = (snapshots ?? []).filter((s) => s.kind !== 'named');

  const row = (s: SnapshotSummary) => (
    <div className={`version${compareA?.id === s.id ? ' selected' : ''}`} key={s.id}>
      <div className="row" style={{ gap: 8 }}>
        <div className="grow">
          <div className="truncate">
            <b>{s.name ?? (s.kind === 'pre_restore' ? 'Before restore' : 'Automatic')}</b>
            <span className="faint small"> · {s.pageCount} {s.pageCount === 1 ? 'page' : 'pages'}</span>
          </div>
          <div className="small muted">
            {timeAgo(s.createdAt)}
            {s.createdBy ? ` · by ${s.createdBy.name}` : ''}
          </div>
        </div>
        <div className="avatar-stack" title={s.authors.length ? `Edited by ${s.authors.map((a) => a.name).join(', ')}` : 'No edits recorded'}>
          {s.authors.slice(0, 3).map((a) => (
            <Avatar key={a.id} user={a} />
          ))}
        </div>
      </div>
      <div className="row version-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => run(async () => setDialog({ mode: 'preview', a: await fetchDetail(s.id) }))}>
          Preview
        </button>
        {compareA && compareA.id !== s.id ? (
          <button className="btn btn-sm" onClick={() => run(async () => { setDialog({ mode: 'compare', a: await fetchDetail(compareA.id), b: await fetchDetail(s.id) }); setCompareA(null); })}>
            Compare with selected
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" aria-pressed={compareA?.id === s.id} onClick={() => setCompareA(compareA?.id === s.id ? null : s)}>
            {compareA?.id === s.id ? 'Selected' : 'Compare…'}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => run(async () => setDialog({ mode: 'compare', a: await fetchDetail(s.id), b: 'current' }))} title="Compare with the script as it is now">
          vs now
        </button>
        <div className="grow" />
        {canRestore && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => restore(s)}>
            Restore
          </button>
        )}
      </div>
    </div>
  );

  return (
    <aside className="comments-panel history-panel" aria-label="Version history">
      <div className="comments-head">
        <h3>History</h3>
        <div className="grow" />
        <button className="btn btn-ghost btn-icon" onClick={props.onClose} aria-label="Close history">
          ✕
        </button>
      </div>
      <div style={{ padding: '0 12px 10px' }}>
        {canName &&
          (naming ? (
            <div className="row">
              <input className="input" placeholder="Draft 2 – table read" value={draftName} autoFocus onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draftName.trim()) nameDraft(); if (e.key === 'Escape') setNaming(false); }} aria-label="Draft name" />
              <button className="btn btn-primary btn-sm" disabled={busy || !draftName.trim()} onClick={nameDraft}>
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-sm btn-block" onClick={() => setNaming(true)}>
              Name the current version
            </button>
          ))}
        {compareA && <p className="small muted" style={{ marginTop: 8 }}>Comparing from <b>{label(compareA)}</b>. Pick the other version.</p>}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="comments-list">
        {snapshots === null ? (
          <div className="spinner" role="status" aria-label="Loading history" />
        ) : snapshots.length === 0 ? (
          <p className="hint">No versions yet. Writers Room saves a copy automatically every 10 minutes of editing and whenever the last person leaves. Name a version to keep a draft.</p>
        ) : (
          <>
            {named.length > 0 && <h4 className="history-group">Named drafts</h4>}
            {named.map(row)}
            {auto.length > 0 && <h4 className="history-group">Automatic</h4>}
            {auto.map(row)}
          </>
        )}
      </div>
      {dialog && (
        <VersionDialog
          project={project}
          mode={dialog.mode}
          a={dialog.a}
          b={dialog.mode === 'compare' ? dialog.b : undefined}
          currentBlocks={currentBlocks}
          canRestore={canRestore}
          onRestore={(s) => restore(s)}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  );
}

export function label(s: SnapshotSummary): string {
  return s.name ?? `${s.kind === 'pre_restore' ? 'the copy from before a restore' : 'the automatic version'} (${timeAgo(s.createdAt)})`;
}
