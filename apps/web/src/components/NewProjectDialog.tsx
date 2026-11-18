import { useState, type FormEvent } from 'react';
import { FORMAT_LABELS, FORMAT_PROFILES, type FormatProfileId, type ProjectSummary } from '@writers-room/shared';
import { api, errorMessage } from '../api';
import { Dialog } from './Dialog';

export function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectSummary) => void }) {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<FormatProfileId>('feature');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ project: ProjectSummary }>('/projects', { method: 'POST', body: { title, formatProfile: format } });
      onCreated(r.project);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title="New project" onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="np-title">Title</label>
          <input id="np-title" className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Working title" />
        </div>
        <div className="field">
          <label htmlFor="np-format">Format</label>
          <select id="np-format" className="select" value={format} onChange={(e) => setFormat(e.target.value as FormatProfileId)}>
            {FORMAT_PROFILES.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
          <p className="small faint">You will be the project's Owner. Invite collaborators from the Share dialog afterwards.</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
