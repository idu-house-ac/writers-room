import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Notification } from '@writers-room/shared';
import { api } from '../api';
import { timeAgo } from '../lib/time';

function describe(n: Notification): string {
  const who = n.payload.actor.name;
  switch (n.type) {
    case 'mention':
      return `${who} mentioned you in ${n.payload.projectTitle}`;
    case 'reply':
      return `${who} replied to a comment in ${n.payload.projectTitle}`;
    case 'invite':
      return `${who} invited you to ${n.payload.projectTitle}`;
  }
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const r = await api<{ notifications: Notification[]; unread: number }>('/notifications');
      setItems(r.notifications);
      setUnread(r.unread);
    } catch {
      /* offline */
    }
  };
  useEffect(() => {
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const markAll = async () => {
    await api('/notifications/read', { method: 'POST', body: {} });
    setUnread(0);
    setItems((l) => l.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn btn-ghost btn-icon bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        🔔
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="menu notifications" role="dialog" aria-label="Notifications">
          <div className="row between" style={{ padding: '6px 8px' }}>
            <b className="small">Notifications</b>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && <p className="hint">Nothing yet. You will see mentions, replies and invitations here.</p>}
          {items.map((n) => (
            <Link
              key={n.id}
              className={`notification${n.readAt ? '' : ' unread'}`}
              to={n.payload.threadId ? `/projects/${n.payload.projectId}?thread=${n.payload.threadId}` : `/projects/${n.payload.projectId}`}
              onClick={() => {
                setOpen(false);
                if (!n.readAt) {
                  void api('/notifications/read', { method: 'POST', body: { ids: [n.id] } });
                  setUnread((u) => Math.max(0, u - 1));
                }
              }}
            >
              <span>{describe(n)}</span>
              {n.payload.excerpt && <span className="small muted truncate">“{n.payload.excerpt}”</span>}
              <span className="small faint">{timeAgo(n.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
