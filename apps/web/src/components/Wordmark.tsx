import { Link } from 'react-router';

export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label="Writers Room home">
      <span className="mark" aria-hidden="true">
        <i />
      </span>
      Writers Room
    </Link>
  );
}
