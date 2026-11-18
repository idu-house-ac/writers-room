import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CurrentUser } from '@writers-room/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Wordmark } from '../components/Wordmark';

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: CurrentUser }>('/auth/reset-password', { method: 'POST', body: { token, password } });
      setUser(r.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card stack" onSubmit={onSubmit} style={{ gap: 16 }}>
        <Wordmark to="/sign-in" />
        <div>
          <h1>Choose a new password</h1>
          <p className="muted small">At least 8 characters. You will be signed in afterwards, and other sessions are signed out.</p>
        </div>
        <div className="field">
          <label htmlFor="password">New password</label>
          <input id="password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="confirm">Repeat new password</label>
          <input id="confirm" className="input" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Set password and sign in'}
        </button>
        <p className="small" style={{ textAlign: 'center' }}>
          <Link to="/forgot-password">Need a new link?</Link>
        </p>
      </form>
    </main>
  );
}
