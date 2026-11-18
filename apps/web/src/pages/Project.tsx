import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { can, type ProjectDetail } from '@writers-room/shared';
import { api, ApiError, errorMessage } from '../api';
import { EditorScreen } from '../editor/EditorScreen';
import { openScriptDoc, type ScriptDoc } from '../editor/scriptDoc';

export function ProjectPage() {
  const { id = '' } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [doc, setDoc] = useState<ScriptDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let opened: ScriptDoc | null = null;
    (async () => {
      try {
        const r = await api<{ project: ProjectDetail }>(`/projects/${id}`);
        if (!active) return;
        setProject(r.project);
        opened = await openScriptDoc(id, can(r.project.myRole, 'edit'));
        if (!active) {
          opened.destroy();
          return;
        }
        setDoc(opened);
        if (import.meta.env.DEV) (window as unknown as { __wrDoc?: ScriptDoc }).__wrDoc = opened;
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiError && err.status === 404 ? 'This project does not exist or you are not a member of it.' : errorMessage(err));
      }
    })();
    return () => {
      active = false;
      opened?.destroy();
    };
  }, [id]);

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
