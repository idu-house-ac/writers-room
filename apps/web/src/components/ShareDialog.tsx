import { useState, type FormEvent } from 'react';
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type InviteSummary, type ProjectDetail, type Role } from '@writers-room/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { timeAgo } from '../lib/time';
import { Avatar } from './Avatar';
import { Dialog } from './Dialog';

export function ShareDialog({ project, onClose, onChange }: { project: ProjectDetail; onClose: () => void; onChange: (p: ProjectDetail) => void }) {
  const { user } = useAuth();
  const canManage = can(project.myRole, 'manage_members');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('writer');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>, okMessage?: string) {
    setBusy(key);
    setError(null);
    setStatus(null);
    try {
      await fn();
      if (okMessage) setStatus(okMessage);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const applyInvites = (invites: InviteSummary[]) => onChange({ ...project, invites });
  const applyProject = (p: Omit<ProjectDetail, 'invites'>) => onChange({ ...p, invites: project.invites });

  function invite(e: FormEvent) {
    e.preventDefault();
    run(
      'invite',
      async () => {
        const r = await api<{ invites: InviteSummary[] }>(`/projects/${project.id}/invites`, { method: 'POST', body: { email, role } });
        applyInvites(r.invites);
        setEmail('');
      },
      `Invitation sent to ${email.trim().toLowerCase()}.`,
    );
  }

  return (
    <Dialog title="Share" onClose={onClose} wide>
      <div className="stack" style={{ gap: 22 }}>
        {canManage && (
          <form onSubmit={invite} className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field grow">
                <label htmlFor="inv-email">Invite by email</label>
                <input id="inv-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </div>
              <div className="field" style={{ width: 150 }}>
                <label htmlFor="inv-role">Role</label>
                <select id="inv-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" disabled={busy === 'invite'}>
                {busy === 'invite' ? 'Sending…' : 'Send invite'}
              </button>
            </div>
            <div className="role-help">
              {ROLES.map((r) => (
                <div key={r} style={{ display: 'contents' }}>
                  <b>{ROLE_LABELS[r]}</b>
                  <span>{ROLE_DESCRIPTIONS[r]}</span>
                </div>
              ))}
            </div>
          </form>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        {status && <p className="notice notice-ok" role="status">{status}</p>}

        <section>
          <h3 style={{ marginBottom: 6 }}>Members</h3>
          <div>
            {project.members.map((m) => {
              const isMe = m.id === user?.id;
              return (
                <div className="member-row" key={m.id}>
                  <Avatar user={m} size="lg" />
                  <div className="grow">
                    <div className="truncate">
                      {m.name} {isMe && <span className="faint small">(you)</span>}
                    </div>
                    <div className="small muted truncate">{m.email}</div>
                  </div>
                  {canManage ? (
                    <>
                      <select
                        className="select btn-sm"
                        style={{ width: 140 }}
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        disabled={busy === `role-${m.id}`}
                        onChange={(e) =>
                          run(`role-${m.id}`, async () => {
                            const r = await api<{ project: Omit<ProjectDetail, 'invites'> }>(`/projects/${project.id}/members/${m.id}`, {
                              method: 'PATCH',
                              body: { role: e.target.value },
                            });
                            applyProject(r.project);
                          })
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-ghost btn-sm btn-danger"
                        disabled={busy === `remove-${m.id}`}
                        onClick={() => {
                          if (!confirm(`Remove ${m.name} from this project?`)) return;
                          run(`remove-${m.id}`, async () => {
                            const r = await api<{ project: Omit<ProjectDetail, 'invites'> }>(`/projects/${project.id}/members/${m.id}`, { method: 'DELETE' });
                            applyProject(r.project);
                          });
                        }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="badge">{ROLE_LABELS[m.role]}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {canManage && (
          <section>
            <h3 style={{ marginBottom: 6 }}>Pending invitations</h3>
            {project.invites.length === 0 ? (
              <p className="small faint">No pending invitations.</p>
            ) : (
              project.invites.map((inv) => (
                <div className="member-row" key={inv.id}>
                  <span className="avatar avatar-lg" style={{ background: 'var(--surface-3)', color: 'var(--muted)' }} aria-hidden="true">
                    ✉
                  </span>
                  <div className="grow">
                    <div className="truncate">{inv.email}</div>
                    <div className="small muted">
                      {ROLE_LABELS[inv.role]} · invited by {inv.invitedBy.name} {timeAgo(inv.createdAt)} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    disabled={busy === `resend-${inv.id}`}
                    onClick={() =>
                      run(
                        `resend-${inv.id}`,
                        async () => {
                          const r = await api<{ invites: InviteSummary[] }>(`/projects/${project.id}/invites/${inv.id}/resend`, { method: 'POST' });
                          applyInvites(r.invites);
                        },
                        `Invitation resent to ${inv.email}.`,
                      )
                    }
                  >
                    Resend
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    disabled={busy === `revoke-${inv.id}`}
                    onClick={() =>
                      run(`revoke-${inv.id}`, async () => {
                        const r = await api<{ invites: InviteSummary[] }>(`/projects/${project.id}/invites/${inv.id}`, { method: 'DELETE' });
                        applyInvites(r.invites);
                      })
                    }
                  >
                    Revoke
                  </button>
                </div>
              ))
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
