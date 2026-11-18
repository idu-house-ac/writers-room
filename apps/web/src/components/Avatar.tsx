import type { UserSummary } from '@writers-room/shared';
import { initials } from '../lib/time';

export function Avatar({ user, size = 'md', title }: { user: Pick<UserSummary, 'name' | 'colour' | 'avatarUrl'>; size?: 'md' | 'lg'; title?: string }) {
  const label = title ?? user.name;
  if (user.avatarUrl) {
    return <img className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`} src={user.avatarUrl} alt={label} title={label} />;
  }
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`} style={{ background: user.colour }} title={label} aria-label={label} role="img">
      {initials(user.name)}
    </span>
  );
}
