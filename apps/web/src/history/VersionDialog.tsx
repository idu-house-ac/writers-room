import { useMemo, useState } from 'react';
import { getProfile, type ProjectDetail, type ScriptBlock, type SnapshotDetail, type SnapshotSummary } from '@writers-room/shared';
import { Dialog } from '../components/Dialog';
import { profileCss } from '../editor/pageStyles';
import { timeAgo } from '../lib/time';
import { diffScripts, diffSummary, jsonToBlocks, type DiffBlock } from './diff';

type Side = SnapshotDetail | 'current';

function name(s: Side): string {
  if (s === 'current') return 'the script now';
  return s.name ?? `${s.kind === 'pre_restore' ? 'Before restore' : 'Automatic'} · ${timeAgo(s.createdAt)}`;
}

/** A read-only rendering of blocks in the paper's own styling. */
function Paper({ blocks, children }: { blocks?: ScriptBlock[]; children?: React.ReactNode }) {
  return (
    <div className="paper preview-paper">
      {blocks?.map((b, i) => (
        <p key={i} className={`el el-${b.type}`}>
          {b.text || ' '}
        </p>
      ))}
      {children}
    </div>
  );
}

function DiffInline({ blocks }: { blocks: DiffBlock[] }) {
  return (
    <Paper>
      {blocks.map((b, i) => (
        <p key={i} className={`el el-${b.type} diff-${b.op}`}>
          {b.pieces.map((p, k) => (
            <span key={k} className={p.op === 'add' ? 'diff-ins' : p.op === 'del' ? 'diff-del' : undefined}>
              {p.text}
            </span>
          ))}
          {b.pieces.length === 0 && ' '}
        </p>
      ))}
    </Paper>
  );
}

function DiffSideBySide({ blocks }: { blocks: DiffBlock[] }) {
  return (
    <div className="side-by-side">
      <Paper>
        {blocks.map((b, i) => (
          <p key={i} className={`el el-${b.type} ${b.op === 'del' || b.op === 'change' ? 'diff-del-block' : ''}`} style={b.op === 'add' ? { visibility: 'hidden' } : undefined}>
            {b.op === 'change' ? b.pieces.filter((p) => p.op !== 'add').map((p, k) => <span key={k} className={p.op === 'del' ? 'diff-del' : undefined}>{p.text}</span>) : b.oldText || ' '}
          </p>
        ))}
      </Paper>
      <Paper>
        {blocks.map((b, i) => (
          <p key={i} className={`el el-${b.type} ${b.op === 'add' || b.op === 'change' ? 'diff-ins-block' : ''}`} style={b.op === 'del' ? { visibility: 'hidden' } : undefined}>
            {b.op === 'change' ? b.pieces.filter((p) => p.op !== 'del').map((p, k) => <span key={k} className={p.op === 'add' ? 'diff-ins' : undefined}>{p.text}</span>) : b.newText || ' '}
          </p>
        ))}
      </Paper>
    </div>
  );
}

export function VersionDialog(props: {
  project: ProjectDetail;
  mode: 'preview' | 'compare';
  a: Side;
  b?: Side;
  currentBlocks: () => ScriptBlock[];
  canRestore: boolean;
  onRestore: (s: SnapshotSummary) => void;
  onClose: () => void;
}) {
  const { a, b } = props;
  const profile = getProfile(props.project.formatProfile);
  const [layout, setLayout] = useState<'inline' | 'side'>('inline');
  const blocksOf = (s: Side) => (s === 'current' ? props.currentBlocks() : jsonToBlocks(s.content));
  const diff = useMemo(() => (props.mode === 'compare' && b ? diffScripts(blocksOf(a), blocksOf(b)) : []), [a, b, props.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = diffSummary(diff);
  const restorable = a !== 'current' ? a : null;

  return (
    <Dialog title={props.mode === 'preview' ? `Preview: ${name(a)}` : `Compare: ${name(a)} → ${name(b!)}`} onClose={props.onClose} wide="xl">
      <style>{profileCss(profile)}</style>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        {props.mode === 'compare' && (
          <>
            <span className="small muted">
              <span className="diff-ins">added</span> · <span className="diff-del">removed</span> · {summary.changed} changed, {summary.added} added, {summary.removed} removed {summary.changed + summary.added + summary.removed === 1 ? 'line' : 'lines'}
            </span>
            <div className="grow" />
            <div className="seg" role="group" aria-label="Layout">
              <button aria-pressed={layout === 'inline'} onClick={() => setLayout('inline')}>
                Inline
              </button>
              <button aria-pressed={layout === 'side'} onClick={() => setLayout('side')}>
                Side by side
              </button>
            </div>
          </>
        )}
        {props.mode === 'preview' && <span className="small muted">Read-only copy. {a !== 'current' && `${a.pageCount} ${a.pageCount === 1 ? 'page' : 'pages'}.`}</span>}
        {props.mode === 'preview' && <div className="grow" />}
        {props.canRestore && restorable && (
          <button className="btn btn-primary btn-sm" onClick={() => props.onRestore(restorable)}>
            Restore this version
          </button>
        )}
      </div>
      <div className="version-body">
        {props.mode === 'preview' ? <Paper blocks={blocksOf(a)} /> : layout === 'inline' ? <DiffInline blocks={diff} /> : <DiffSideBySide blocks={diff} />}
      </div>
    </Dialog>
  );
}
