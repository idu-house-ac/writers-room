import { useEffect, type ReactNode } from 'react';

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean | 'xl' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card dialog${wide === 'xl' ? ' dialog-xl' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" style={wide === true ? { maxWidth: 680 } : undefined}>
        <div className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
