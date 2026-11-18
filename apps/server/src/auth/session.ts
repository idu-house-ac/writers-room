import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CurrentUser } from '@writers-room/shared';
import type { Config } from '../config';
import type { Queryable } from '../db';
import { randomToken } from './password';

export const SESSION_COOKIE = 'wr_session';
const SESSION_DAYS = 30;
const TOUCH_AFTER_MS = 60 * 60 * 1000; // extend the session at most once an hour

export interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  colour: string;
  created_at: Date;
}

export function toCurrentUser(row: UserRow): CurrentUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    colour: row.colour,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createSession(db: Queryable, userId: string): Promise<string> {
  const id = randomToken(32);
  await db.query(
    `insert into sessions (id, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`,
    [id, userId, String(SESSION_DAYS)],
  );
  return id;
}

export async function loadSession(db: Queryable, sessionId: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow & { last_seen_at: Date }>(
    `select u.id, u.email, u.name, u.avatar_url, u.colour, u.created_at, s.last_seen_at
       from sessions s join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    await db.query(
      `update sessions set last_seen_at = now(), expires_at = now() + ($2 || ' days')::interval where id = $1`,
      [sessionId, String(SESSION_DAYS)],
    );
  }
  return row;
}

export async function deleteSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query('delete from sessions where id = $1', [sessionId]);
}

export async function deleteAllSessions(db: Queryable, userId: string): Promise<void> {
  await db.query('delete from sessions where user_id = $1', [userId]);
}

export function setSessionCookie(reply: FastifyReply, config: Config, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    signed: true,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
}

export function readSessionId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}
