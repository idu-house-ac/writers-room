import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { CommentThread } from '@writers-room/shared';
import { api } from '../api';
import { commentMarksKey } from './commentMarks';

/** Loads the project's threads, keeps the editor highlights in sync, refreshes when anyone changes them. */
export function useComments(projectId: string, editor: Editor | null, provider: HocuspocusProvider) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const push = useCallback((list: CommentThread[], active: string | null | undefined) => {
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(commentMarksKey, { threads: list, activeId: active }).setMeta('addToHistory', false));
  }, []);

  const reload = useCallback(async () => {
    const r = await api<{ threads: CommentThread[] }>(`/projects/${projectId}/comments`);
    setThreads(r.threads);
    push(r.threads, undefined);
  }, [projectId, push]);

  useEffect(() => {
    void reload();
    const onStateless = ({ payload }: { payload: string }) => {
      try {
        if ((JSON.parse(payload) as { type?: string }).type === 'comments') void reload();
      } catch {
        /* not ours */
      }
    };
    provider.on('stateless', onStateless);
    const t = setInterval(() => void reload(), 30_000);
    return () => {
      provider.off('stateless', onStateless);
      clearInterval(t);
    };
  }, [provider, reload]);

  // Re-push when the editor instance appears after the first load.
  useEffect(() => {
    if (editor) push(threads, activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const setActiveId = useCallback(
    (id: string | null) => {
      setActiveIdState(id);
      push(threads, id);
    },
    [threads, push],
  );

  const apply = useCallback(
    (thread: CommentThread | null, removedId?: string) => {
      setThreads((list) => {
        const next = thread ? (list.some((t) => t.id === thread.id) ? list.map((t) => (t.id === thread.id ? thread : t)) : [...list, thread]) : list.filter((t) => t.id !== removedId);
        push(next, undefined);
        return next;
      });
    },
    [push],
  );

  return { threads, activeId, setActiveId, reload, apply };
}
