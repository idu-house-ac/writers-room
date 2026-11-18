import type { Collaborator } from './presence';
import { initials } from '../lib/time';

/** Avatars of everyone else in the project. Click one to follow their cursor. */
export function PresenceBar({ people, following, onFollow }: { people: Collaborator[]; following: number | null; onFollow: (clientId: number | null) => void }) {
  // One avatar per person even if they have several tabs open.
  const byUser = new Map<string, Collaborator>();
  for (const p of people) if (!byUser.has(p.id)) byUser.set(p.id, p);
  const list = [...byUser.values()];
  if (!list.length) return <span className="small faint">Only you here</span>;
  return (
    <div className="presence" aria-label="Collaborators here now">
      {list.map((p) => {
        const active = following !== null && people.some((q) => q.clientId === following && q.id === p.id);
        return (
          <button
            key={p.id}
            className={`presence-chip${active ? ' following' : ''}`}
            style={{ ['--c' as string]: p.color }}
            onClick={() => onFollow(active ? null : p.clientId)}
            title={active ? `Following ${p.name} (click to stop)` : `${p.name} is here. Click to follow their cursor.`}
          >
            <span className="avatar" style={{ background: p.color }}>
              {initials(p.name)}
            </span>
            <span className="presence-name">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
