import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { can, FORMAT_LABELS, ROLE_LABELS, type ProjectDetail } from '@writers-room/shared';
import { api, ApiError, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components/Avatar';
import { Menu } from '../components/Menu';
import { ShareDialog } from '../components/ShareDialog';
import { Wordmark } from '../components/Wordmark';

export function ProjectPage() {
  const { id = '' } = useParams();
  const { user, signOut } = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    api<{ project: ProjectDetail }>(`/projects/${id}`)
      .then((r) => setProject(r.project))
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'This project does not exist or you are not a member of it.' : errorMessage(err)));
  }, [id]);

  async function saveTitle() {
    if (!project) return;
    const next = title.trim();
    setRenaming(false);
    if (!next || next === project.title) return;
    try {
      const r = await api<{ project: Omit<ProjectDetail, 'invites'> }>(`/projects/${project.id}`, { method: 'PATCH', body: { title: next } });
      setProject({ ...r.project, invites: project.invites });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

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
  if (!project) return <div className="spinner" role="status" aria-label="Loading project" />;

  const canEdit = can(project.myRole, 'edit');

  return (
    <>
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
              <button
                role="menuitem"
                onClick={async () => {
                  close();
                  await signOut();
                }}
              >
                Sign out ({user.email})
              </button>
            )}
          </Menu>
        )}
      </header>

      <main className="page">
        <section className="card coming">
          <div className="paper" aria-hidden="true">
            INT. WRITERS ROOM - DAY
            <br />
            <br />
            The editor is not here yet. A blank page waits.
            <br />
            <br />
            <span style={{ paddingLeft: 40 }}>AMADIN</span>
            <br />
            <span style={{ paddingLeft: 20 }}>Milestone one, then.</span>
          </div>
          <h2>The script editor arrives in milestone M1</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            M0 covers accounts, invitations, roles and the projects dashboard. Use <b>Share</b> above to invite collaborators and set their roles.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link to="/">← Back to projects</Link>
          </p>
        </section>
      </main>

      {sharing && <ShareDialog project={project} onClose={() => setSharing(false)} onChange={setProject} />}
    </>
  );
}
