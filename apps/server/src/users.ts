import { PRESENCE_COLOURS } from '@writers-room/shared';
import type { Queryable } from './db';
import { hashPassword } from './auth/password';
import type { UserRow } from './auth/session';

export const USER_COLUMNS = 'id, email, name, avatar_url, colour, created_at';

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(db: Queryable, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`select ${USER_COLUMNS} from users where email = $1`, [normaliseEmail(email)]);
  return rows[0] ?? null;
}

export async function createUser(db: Queryable, input: { email: string; name: string; password: string }): Promise<UserRow> {
  const { rows: countRows } = await db.query<{ n: string }>('select count(*)::text as n from users');
  const n = Number(countRows[0]?.n ?? 0);
  const colour = PRESENCE_COLOURS[n % PRESENCE_COLOURS.length]!;
  const passwordHash = await hashPassword(input.password);
  const { rows } = await db.query<UserRow>(
    `insert into users (email, name, colour, password_hash) values ($1, $2, $3, $4) returning ${USER_COLUMNS}`,
    [normaliseEmail(input.email), input.name.trim(), colour, passwordHash],
  );
  return rows[0]!;
}
