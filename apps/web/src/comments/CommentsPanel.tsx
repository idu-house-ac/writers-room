import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { can, type CommentThread, type MemberSummary, type ProjectDetail } from '@writers-room/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../lib/time';
import { commentMarksKey } from './commentMarks';
import { MentionInput } from './MentionInput';

type Filter = 'open' | 'resolved' | 'mine';

export interface Draft {
  anchorStart: string;
  anchorEnd: string;
  quotedText: string;
}

/** Render "@Name" for mentioned members in the comment's own colour. */
function Body({ text, members }: { text: string; members: MemberSummary[] }) {
  const names = members.map((m) => m.name).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{text}</>;
  const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts: (string | { name: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    parts.push(text.slice(last, m.index), { name: m[1]! });
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <span key={i} className="mention">@{p.name}</span>))}
    </>
  );
}

export function CommentsPanel(props: {
  project: ProjectDetail;
  editor: Editor | null;
  threads: CommentThread[];
  activeId: string | null;
  onActive: (id: string | null) => void;
  onApply: (thread: CommentThread | null, removedId?: string) => void;
  draft: Draft | null;
  onDraftDone: () => void;
  onClose: () => void;
}) {
  const { project, editor, threads, activeId, draft } = props;
  const { user } = useAuth();
  const canComment = can(project.myRole, 'comment');
  const [filter, setFilter] = useState<Filter>('open');
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ text: string; mentions: string[] }>({ text: '', mentions: [] });
  const [reply, setReply] = useState<{ threadId: string; text: string; mentions: string[] } | null>(null);
  const [editing, setEditing] = useState<{ commentId: string; text: string; mentions: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const ranges = editor ? commentMarksKey.getState(editor.state)?.ranges : undefined;

  const visible = useMemo(() => {
    const withPos = threads.map((t) => ({ t, r: ranges?.get(t.id) }));
    const filtered = withPos.filter(({ t }) => {
      if (filter === 'mine') return t.comments.some((c) => c.author.id === user?.id) || t.comments.some((c) => c.mentions.includes(user?.id ?? ''));
      if (filter === 'resolved') return t.status === 'resolved';
      return t.status !== 'resolved'; // open and detached: never hidden, never deleted
    });
    return filtered.sort((a, b) => (a.r?.detached ? 1 : 0) - (b.r?.detached ? 1 : 0) || (a.r?.from ?? 0) - (b.r?.from ?? 0) || a.t.createdAt.localeCompare(b.t.createdAt));
  }, [threads, ranges, filter, user?.id]);

  useEffect(() => {
    if (activeId) document.getElementById(`thread-${activeId}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

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

  const jump = (t: CommentThread) => {
    props.onActive(t.id);
    const r = ranges?.get(t.id);
    if (!editor || !r || r.detached) return;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, r.from, r.to)).scrollIntoView());
  };

  const submitNew = () =>
    run(async () => {
      if (!draft) return;
      const r = await api<{ thread: CommentThread }>(`/projects/${project.id}/comments`, { method: 'POST', body: { ...draft, body: composer.text, mentions: composer.mentions } });
      props.onApply(r.thread);
      setComposer({ text: '', mentions: [] });
      props.onDraftDone();
      props.onActive(r.thread.id);
    });

  const submitReply = () =>
    run(async () => {
      if (!reply) return;
      const r = await api<{ thread: CommentThread }>(`/projects/${project.id}/comments/${reply.threadId}/replies`, { method: 'POST', body: { body: reply.text, mentions: reply.mentions } });
      props.onApply(r.thread);
      setReply(null);
    });

  const setStatus = (t: CommentThread, status: 'open' | 'resolved') =>
    run(async () => {
      const r = await api<{ thread: CommentThread }>(`/projects/${project.id}/comments/${t.id}`, { method: 'PATCH', body: { status } });
      props.onApply(r.thread);
    });

  const saveEdit = (t: CommentThread) =>
    run(async () => {
      if (!editing) return;
      const r = await api<{ thread: CommentThread }>(`/projects/${project.id}/comments/${t.id}/replies/${editing.commentId}`, { method: 'PATCH', body: { body: editing.text, mentions: editing.mentions } });
      props.onApply(r.thread);
      setEditing(null);
    });

  const remove = (t: CommentThread, commentId: string) =>
    run(async () => {
      if (!confirm('Delete this comment?')) return;
      const r = await api<{ thread: CommentThread | null }>(`/projects/${project.id}/comments/${t.id}/replies/${commentId}`, { method: 'DELETE' });
      props.onApply(r.thread, t.id);
    });

  const counts = { open: threads.filter((t) => t.status === 'open').length, resolved: threads.filter((t) => t.status === 'resolved').length };

  return (
    <aside className="comments-panel" aria-label="Comments">
      <div className="comments-head">
        <h3>Comments</h3>
        <div className="grow" />
        <button className="btn btn-ghost btn-icon" onClick={props.onClose} aria-label="Close comments">
          ✕
        </button>
      </div>
      <div className="chips" style={{ padding: '0 12px 10px' }} role="group" aria-label="Filter comments">
        <button className="chip" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>
          Open {counts.open ? `(${counts.open})` : ''}
        </button>
        <button className="chip" aria-pressed={filter === 'resolved'} onClick={() => setFilter('resolved')}>
          Resolved {counts.resolved ? `(${counts.resolved})` : ''}
        </button>
        <button className="chip" aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>
          Mine
        </button>
      </div>
      {error && <p className="error" style={{ padding: '0 12px 8px' }}>{error}</p>}

      <div className="comments-list">
        {draft && canComment && (
          <div className="thread composing">
            <blockquote className="quote">{draft.quotedText || '(selection)'}</blockquote>
            <MentionInput members={project.members} value={composer.text} onChange={(text, mentions) => setComposer({ text, mentions })} onSubmit={submitNew} autoFocus placeholder="Comment on this selection. Type @ to mention someone." />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={props.onDraftDone}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" disabled={busy || !composer.text.trim()} onClick={submitNew}>
                Comment
              </button>
            </div>
          </div>
        )}

        {visible.length === 0 && !draft && (
          <p className="hint">
            {filter === 'open' ? (canComment ? 'No open comments. Select some text and press Comment.' : 'No open comments.') : filter === 'resolved' ? 'Nothing resolved yet.' : 'No comments involve you yet.'}
          </p>
        )}

        {visible.map(({ t, r }) => {
          const detached = r?.detached || t.status === 'detached';
          return (
            <div key={t.id} id={`thread-${t.id}`} className={`thread${t.id === activeId ? ' active' : ''}${detached ? ' detached' : ''}`} onClick={() => props.onActive(t.id)}>
              <blockquote className="quote" onClick={() => jump(t)} title={detached ? undefined : 'Jump to this text'}>
                {t.quotedText || '(selection)'}
              </blockquote>
              {detached && <p className="small faint" style={{ margin: '0 0 6px' }}>No longer in the script</p>}
              {t.comments.map((c) => (
                <div className="comment" key={c.id}>
                  <div className="row" style={{ gap: 8 }}>
                    <Avatar user={c.author} />
                    <span className="grow truncate">
                      <b>{c.author.name}</b> <span className="faint small">{timeAgo(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
                    </span>
                    {canComment && (c.author.id === user?.id || project.myRole === 'owner') && (
                      <span className="comment-actions">
                        {c.author.id === user?.id && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ commentId: c.id, text: c.body, mentions: c.mentions })}>
                            Edit
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(t, c.id)}>
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                  {editing?.commentId === c.id ? (
                    <div style={{ marginTop: 6 }}>
                      <MentionInput members={project.members} value={editing.text} onChange={(text, mentions) => setEditing({ ...editing, text, mentions })} onSubmit={() => saveEdit(t)} autoFocus />
                      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveEdit(t)}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="comment-body">
                      <Body text={c.body} members={project.members} />
                    </p>
                  )}
                </div>
              ))}
              {canComment && (
                <div className="thread-foot">
                  {reply?.threadId === t.id ? (
                    <div>
                      <MentionInput members={project.members} value={reply.text} onChange={(text, mentions) => setReply({ threadId: t.id, text, mentions })} onSubmit={submitReply} autoFocus placeholder="Reply. Type @ to mention someone." />
                      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setReply(null)}>
                          Cancel
                        </button>
                        <button className="btn btn-primary btn-sm" disabled={busy || !reply.text.trim()} onClick={submitReply}>
                          Reply
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="row">
                      <button className="btn btn-ghost btn-sm" onClick={() => setReply({ threadId: t.id, text: '', mentions: [] })}>
                        Reply
                      </button>
                      <div className="grow" />
                      {t.status === 'resolved' ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => setStatus(t, 'open')} title={t.resolvedBy ? `Resolved by ${t.resolvedBy.name}` : undefined}>
                          Reopen
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setStatus(t, 'resolved')}>
                          Resolve
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
