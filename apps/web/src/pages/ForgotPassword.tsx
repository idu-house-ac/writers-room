import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api';
import { Wordmark } from '../components/Wordmark';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
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
          <h1>Reset your password</h1>
          <p className="muted small">Enter your email and we will send a link to choose a new password.</p>
        </div>
        {sent ? (
          <div className="notice notice-ok" role="status">
            If an account exists for <b>{email}</b>, an email with a reset link is on its way. The link works for one hour.
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}
        <p className="small" style={{ textAlign: 'center' }}>
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      </form>
    </main>
  );
}
