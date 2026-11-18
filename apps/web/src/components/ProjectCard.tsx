import { Link } from 'react-router';
import { can, FORMAT_LABELS, ROLE_LABELS, type ProjectSummary } from '@writers-room/shared';
import { timeAgo } from '../lib/time';
import { Avatar } from './Avatar';
import { Menu } from './Menu';

export function ProjectCard({
  project,
  onArchive,
  onUnarchive,
  onDuplicate,
}: {
  project: ProjectSummary;
  onArchive: () => void;
  onUnarchive: () => void;
  onDuplicate: () => void;
}) {
  const archived = Boolean(project.archivedAt);
  const writers = project.members.filter((m) => m.role === 'owner' || m.role === 'writer').map((m) => m.name);
  return (
    <article className={`card project-card`} aria-label={project.title}>
      <Link to={`/projects/${project.id}`} className="open-link" aria-label={`Open ${project.title}`} />
      <div className={`thumb ${archived ? 'archived' : ''}`} aria-hidden="true">
        <div className="t truncate">{project.title}</div>
        {writers.length > 0 && (
          <div className="by">
            written by
            <br />
            {writers.slice(0, 2).join(' & ')}
            {writers.length > 2 ? ' & others' : ''}
          </div>
        )}
      </div>
      <div className="body">
        <div className="row between title-row">
          <div className="title truncate grow">{project.title}</div>
          <Menu label={`Actions for ${project.title}`}>
            {(close) => (
              <>
                {can(project.myRole, 'duplicate') && (
                  <button role="menuitem" onClick={() => { close(); onDuplicate(); }}>
                    Duplicate
                  </button>
                )}
                {can(project.myRole, 'archive') &&
                  (archived ? (
                    <button role="menuitem" onClick={() => { close(); onUnarchive(); }}>
                      Unarchive
                    </button>
                  ) : (
                    <button role="menuitem" className="danger" onClick={() => { close(); onArchive(); }}>
                      Archive
                    </button>
                  ))}
                {!can(project.myRole, 'duplicate') && !can(project.myRole, 'archive') && (
                  <button role="menuitem" disabled>
                    No actions for {ROLE_LABELS[project.myRole]}s
                  </button>
                )}
              </>
            )}
          </Menu>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="badge badge-accent">{FORMAT_LABELS[project.formatProfile]}</span>
          <span className="badge">{ROLE_LABELS[project.myRole]}</span>
          {archived && <span className="badge">Archived</span>}
        </div>
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <span className="small muted">
            {project.pageCount === null ? 'No script yet' : `${project.pageCount} pages`}
            <br />
            Edited {timeAgo(project.updatedAt)}
            {project.lastEditedBy ? ` by ${project.lastEditedBy.name}` : ''}
          </span>
          <div className="avatar-stack" aria-label={`${project.members.length} members`}>
            {project.members.slice(0, 4).map((m) => (
              <Avatar key={m.id} user={m} title={`${m.name} · ${ROLE_LABELS[m.role]}`} />
            ))}
            {project.members.length > 4 && (
              <span className="avatar" style={{ background: 'var(--surface-3)', color: 'var(--muted)' }}>
                +{project.members.length - 4}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
