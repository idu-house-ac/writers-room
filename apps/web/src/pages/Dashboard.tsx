import { useEffect, useMemo, useState } from 'react';
import { FORMAT_LABELS, FORMAT_PROFILES, type FormatProfileId, type ProjectSummary } from '@writers-room/shared';
import { api, errorMessage } from '../api';
import { NewProjectDialog } from '../components/NewProjectDialog';
import { ProjectCard } from '../components/ProjectCard';
import { TopBar } from '../components/TopBar';

export function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [format, setFormat] = useState<FormatProfileId | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const r = await api<{ projects: ProjectSummary[] }>(`/projects${showArchived ? '?archived=1' : ''}`);
      setProjects(r.projects);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (projects ?? []).filter((p) => (format === 'all' || p.formatProfile === format) && (!q || p.title.toLowerCase().includes(q)));
  }, [projects, search, format]);

  async function act(path: string, method = 'POST') {
    try {
      await api(path, { method });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <TopBar search={search} onSearch={setSearch} />
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Projects</h1>
            <p className="muted small">Everything you are a member of, most recently edited first.</p>
          </div>
          <div className="row">
            <button className="btn" disabled title="Importing Fountain and Final Draft files arrives in milestone M6">
              Import
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              New project
            </button>
          </div>
        </div>

        <div className="row between wrap" style={{ marginBottom: 18 }}>
          <div className="chips" role="group" aria-label="Filter by format">
            <button className="chip" aria-pressed={format === 'all'} onClick={() => setFormat('all')}>
              All
            </button>
            {FORMAT_PROFILES.map((f) => (
              <button key={f} className="chip" aria-pressed={format === f} onClick={() => setFormat(f)}>
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </div>

        {error && <p className="notice notice-error" role="alert" style={{ marginBottom: 16 }}>{error}</p>}

        {projects === null ? (
          <div className="spinner" role="status" aria-label="Loading projects" />
        ) : visible.length === 0 ? (
          <div className="empty">
            {projects.length === 0 ? (
              <>
                <p>No projects yet.</p>
                <p className="small" style={{ marginTop: 6 }}>
                  Create one, or wait for an invitation from a collaborator.
                </p>
              </>
            ) : (
              <p>No projects match.</p>
            )}
          </div>
        ) : (
          <div className="grid">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onArchive={() => act(`/projects/${p.id}/archive`)}
                onUnarchive={() => act(`/projects/${p.id}/unarchive`)}
                onDuplicate={() => act(`/projects/${p.id}/duplicate`)}
              />
            ))}
          </div>
        )}
      </main>

      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setProjects((list) => [p, ...(list ?? [])]);
          }}
        />
      )}
    </>
  );
}
