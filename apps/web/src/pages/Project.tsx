import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { can, type ProjectDetail } from '@writers-room/shared';
import { api, ApiError, errorMessage } from '../api';
import { useAuth } from '../auth';
import { EditorScreen } from '../editor/EditorScreen';
import { openCollabDoc, type CollabDoc } from '../editor/collab';

export function ProjectPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [doc, setDoc] = useState<CollabDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let opened: CollabDoc | null = null;
    if (!user) return;
    (async () => {
      try {
        const r = await api<{ project: ProjectDetail }>(`/projects/${id}`);
        if (!active) return;
        setProject(r.project);
        opened = await openCollabDoc(id, user, can(r.project.myRole, 'edit'));
        if (!active) {
          opened.destroy();
          return;
        }
        setDoc(opened);
        if (import.meta.env.DEV) (window as unknown as { __wrDoc?: CollabDoc }).__wrDoc = opened;
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiError && err.status === 404 ? 'This project does not exist or you are not a member of it.' : errorMessage(err));
      }
    })();
    return () => {
      active = false;
      opened?.destroy();
    };
  }, [id, user]);

  if (error) {
    return (
      <main className="page">
        <p className="notice notice-error">{error}</p>
        <p style={{ marginTop: 12 }}>
          <Link to="/">Back to projects</Link>
        </p>
      </main>
    );
  }
  if (!project || !doc) return <div className="editor-loading">Opening script…</div>;
  return <EditorScreen project={project} doc={doc} onProjectChange={setProject} />;
}
