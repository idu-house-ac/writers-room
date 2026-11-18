import { useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { Avatar } from './Avatar';
import { Menu } from './Menu';
import { Wordmark } from './Wordmark';

export function TopBar({ search, onSearch }: { search?: string; onSearch?: (v: string) => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <Wordmark />
      {onSearch && (
        <input
          className="input search"
          type="search"
          placeholder="Search projects"
          value={search ?? ''}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search projects"
        />
      )}
      <div className="grow" />
      {user && (
        <div className="row">
          <Avatar user={user} />
          <span className="small truncate" style={{ maxWidth: 160 }}>
            {user.name}
          </span>
          <Menu label="Account menu">
            {(close) => (
              <>
                <button role="menuitem" disabled title={user.email}>
                  {user.email}
                </button>
                <button
                  role="menuitem"
                  onClick={async () => {
                    close();
                    await signOut();
                    navigate('/sign-in');
                  }}
                >
                  Sign out
                </button>
              </>
            )}
          </Menu>
        </div>
      )}
    </header>
  );
}
