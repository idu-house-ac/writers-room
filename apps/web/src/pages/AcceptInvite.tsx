import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type CurrentUser, type InvitePreview } from '@writers-room/shared';
import { api, ApiError, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Wordmark } from '../components/Wordmark';

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { user, loading, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: InvitePreview }>(`/auth/invites/${token}`)
      .then((r) => setInvite(r.invite))
      .catch((err) => setLoadError(err instanceof ApiError && err.status === 404 ? 'This invitation link is not valid any more. Ask the project owner to send a new one.' : errorMessage(err)));
  }, [token]);

  async function accept(body: { name?: string; password?: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: CurrentUser; projectId: string }>(`/auth/invites/${token}/accept`, { method: 'POST', body });
      setUser(r.user);
      navigate(`/projects/${r.projectId}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const signedInAsInvitee = Boolean(user && invite && user.email === invite.email);
  const signedInAsSomeoneElse = Boolean(user && invite && user.email !== invite.email);

  return (
    <main className="auth-page">
      <div className="card auth-card stack" style={{ gap: 16 }}>
        <Wordmark to="/sign-in" />
        {loadError ? (
          <>
            <h1>Invitation not found</h1>
            <p className="notice notice-error">{loadError}</p>
            <p className="small">
              <Link to="/sign-in">Go to sign in</Link>
            </p>
          </>
        ) : !invite || loading ? (
          <div className="spinner" role="status" aria-label="Loading" />
        ) : (
          <>
            <div>
              <h1>You're invited</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                <b style={{ color: 'var(--text)' }}>{invite.invitedBy.name}</b> invited <b style={{ color: 'var(--text)' }}>{invite.email}</b> to join{' '}
                <b style={{ color: 'var(--text)' }}>{invite.project.title}</b> as <b style={{ color: 'var(--text)' }}>{ROLE_LABELS[invite.role]}</b>.
              </p>
              <p className="small faint" style={{ marginTop: 4 }}>
                {ROLE_DESCRIPTIONS[invite.role]}
              </p>
            </div>

            {invite.expired ? (
              <p className="notice notice-error">This invitation has expired. Ask {invite.invitedBy.name} to send a new one.</p>
            ) : signedInAsSomeoneElse ? (
              <div className="stack">
                <p className="notice">
                  You are signed in as <b>{user!.email}</b>, but this invitation is for <b>{invite.email}</b>.
                </p>
                <button className="btn btn-block" onClick={() => signOut()}>
                  Sign out and continue as {invite.email}
                </button>
              </div>
            ) : signedInAsInvitee ? (
              <>
                {error && <p className="error" role="alert">{error}</p>}
                <button className="btn btn-primary btn-block" disabled={busy} onClick={() => accept({})}>
                  {busy ? 'Joining…' : `Join ${invite.project.title}`}
                </button>
              </>
            ) : invite.accountExists ? (
              <form
                className="stack"
                style={{ gap: 14 }}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  accept({ password });
                }}
              >
                <p className="small muted">You already have an account. Enter your password to accept.</p>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                </div>
                {error && <p className="error" role="alert">{error}</p>}
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? 'Joining…' : 'Sign in and join'}
                </button>
                <p className="small" style={{ textAlign: 'center' }}>
                  <Link to="/forgot-password">Forgot your password?</Link>
                </p>
              </form>
            ) : (
              <form
                className="stack"
                style={{ gap: 14 }}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  accept({ name, password });
                }}
              >
                <p className="small muted">Create your account to accept. Your email will be {invite.email}.</p>
                <div className="field">
                  <label htmlFor="name">Your name</label>
                  <input id="name" className="input" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="As collaborators will see it" />
                </div>
                <div className="field">
                  <label htmlFor="password">Choose a password</label>
                  <input id="password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                {error && <p className="error" role="alert">{error}</p>}
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? 'Creating account…' : 'Create account and join'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
