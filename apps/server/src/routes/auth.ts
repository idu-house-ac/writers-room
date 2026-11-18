import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_LABELS, type InvitePreview, type Role } from '@writers-room/shared';
import type { AppContext } from '../app';
import { hashPassword, hashToken, MIN_PASSWORD_LENGTH, randomToken, verifyPassword } from '../auth/password';
import {
  clearSessionCookie,
  createSession,
  deleteAllSessions,
  deleteSession,
  setSessionCookie,
  toCurrentUser,
  type UserRow,
} from '../auth/session';
import { withTransaction } from '../db';
import { badRequest, gone, notFound, parseBody, unauthorized } from '../errors';
import { passwordResetEmail } from '../mail';
import { requireUser } from '../plugins/auth';
import { createUser, findUserByEmail, normaliseEmail, USER_COLUMNS } from '../users';

const RESET_MINUTES = 60;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(200);

interface InviteRow {
  id: string;
  email: string;
  role: Role;
  project_id: string;
  project_title: string;
  inviter_name: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

async function findInviteByToken(ctx: AppContext, token: string): Promise<InviteRow> {
  const { rows } = await ctx.db.query<InviteRow>(
    `select i.id, i.email, i.role, i.project_id, p.title as project_title, u.name as inviter_name,
            i.expires_at, i.accepted_at, i.revoked_at
       from invites i
       join projects p on p.id = i.project_id
       join users u on u.id = i.invited_by
      where i.token_hash = $1`,
    [hashToken(token)],
  );
  const invite = rows[0];
  if (!invite || invite.revoked_at || invite.accepted_at) throw notFound('This invitation link is not valid any more.');
  return invite;
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const strictLimit = ctx.rateLimit ? { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } } : {};

  app.post('/auth/sign-in', strictLimit, async (request, reply) => {
    const body = parseBody(z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password.') }), request.body);
    const { rows } = await ctx.db.query<UserRow & { password_hash: string }>(
      `select ${USER_COLUMNS}, password_hash from users where email = $1`,
      [body.email],
    );
    const user = rows[0];
    const ok = user ? await verifyPassword(body.password, user.password_hash) : false;
    if (!user || !ok) throw unauthorized('Incorrect email or password.', 'invalid_credentials');
    const sessionId = await createSession(ctx.db, user.id);
    setSessionCookie(reply, ctx.config, sessionId);
    return { user: toCurrentUser(user) };
  });

  app.post('/auth/sign-out', async (request, reply) => {
    if (request.sessionId) await deleteSession(ctx.db, request.sessionId);
    clearSessionCookie(reply, ctx.config);
    return { ok: true };
  });

  app.get('/auth/me', async (request) => {
    const user = requireUser(request);
    return { user: toCurrentUser(user) };
  });

  app.post('/auth/forgot-password', strictLimit, async (request) => {
    const body = parseBody(z.object({ email: emailSchema }), request.body);
    const user = await findUserByEmail(ctx.db, body.email);
    // Always answer the same way so the form does not reveal which emails have accounts.
    if (user) {
      const token = randomToken();
      await ctx.db.query(
        `insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' minutes')::interval)`,
        [hashToken(token), user.id, String(RESET_MINUTES)],
      );
      const link = `${ctx.config.APP_ORIGIN}/reset-password/${token}`;
      await ctx.mailer.send(passwordResetEmail({ to: user.email, name: user.name, link, expiresInMinutes: RESET_MINUTES }));
    }
    return { ok: true };
  });

  app.post('/auth/reset-password', strictLimit, async (request, reply) => {
    const body = parseBody(z.object({ token: z.string().min(1), password: passwordSchema }), request.body);
    const result = await withTransaction(ctx.db, async (tx) => {
      const { rows } = await tx.query<{ user_id: string; expires_at: Date; used_at: Date | null }>(
        'select user_id, expires_at, used_at from password_resets where token_hash = $1 for update',
        [hashToken(body.token)],
      );
      const row = rows[0];
      if (!row || row.used_at) throw notFound('This reset link is not valid any more. Ask for a new one.');
      if (row.expires_at.getTime() < Date.now()) throw gone('This reset link has expired. Ask for a new one.');
      await tx.query('update password_resets set used_at = now() where token_hash = $1', [hashToken(body.token)]);
      await tx.query('update users set password_hash = $2 where id = $1', [row.user_id, await hashPassword(body.password)]);
      await deleteAllSessions(tx, row.user_id);
      const { rows: users } = await tx.query<UserRow>(`select ${USER_COLUMNS} from users where id = $1`, [row.user_id]);
      const sessionId = await createSession(tx, row.user_id);
      return { user: users[0]!, sessionId };
    });
    setSessionCookie(reply, ctx.config, result.sessionId);
    return { user: toCurrentUser(result.user) };
  });

  // Public preview of an invitation, used by the accept page.
  app.get<{ Params: { token: string } }>('/auth/invites/:token', async (request) => {
    const invite = await findInviteByToken(ctx, request.params.token);
    const existing = await findUserByEmail(ctx.db, invite.email);
    const preview: InvitePreview = {
      email: invite.email,
      role: invite.role,
      project: { id: invite.project_id, title: invite.project_title },
      invitedBy: { name: invite.inviter_name },
      accountExists: Boolean(existing),
      expired: invite.expires_at.getTime() < Date.now(),
    };
    return { invite: preview };
  });

  /**
   * Accept an invitation.
   *  - New email: body needs name + password; creates the account, the membership and a session.
   *  - Existing account, signed in as that email: adds the membership.
   *  - Existing account, not signed in: body needs password; signs in, then adds the membership.
   */
  app.post<{ Params: { token: string } }>('/auth/invites/:token/accept', strictLimit, async (request, reply) => {
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(100).optional(), password: z.string().max(200).optional() }),
      request.body,
    );
    const invite = await findInviteByToken(ctx, request.params.token);
    if (invite.expires_at.getTime() < Date.now()) throw gone('This invitation has expired. Ask the project owner to send a new one.');

    const result = await withTransaction(ctx.db, async (tx) => {
      let user: UserRow;
      let sessionId: string | null = null;
      const existing = await findUserByEmail(tx, invite.email);

      if (existing) {
        if (request.user && request.user.id === existing.id) {
          user = existing;
        } else {
          if (!body.password) throw unauthorized('Sign in to accept this invitation.', 'sign_in_required');
          const { rows } = await tx.query<{ password_hash: string }>('select password_hash from users where id = $1', [existing.id]);
          if (!(await verifyPassword(body.password, rows[0]!.password_hash))) {
            throw unauthorized('Incorrect password.', 'invalid_credentials');
          }
          user = existing;
          sessionId = await createSession(tx, user.id);
        }
      } else {
        if (!body.name) throw badRequest('name: Enter your name.');
        const password = parseBody(passwordSchema, body.password ?? '');
        user = await createUser(tx, { email: invite.email, name: body.name, password });
        sessionId = await createSession(tx, user.id);
      }

      await tx.query(
        `insert into project_members (project_id, user_id, role) values ($1, $2, $3)
         on conflict (project_id, user_id) do nothing`,
        [invite.project_id, user.id, invite.role],
      );
      await tx.query('update invites set accepted_at = now() where id = $1', [invite.id]);
      return { user, sessionId };
    });

    if (result.sessionId) setSessionCookie(reply, ctx.config, result.sessionId);
    return { user: toCurrentUser(result.user), projectId: invite.project_id, roleLabel: ROLE_LABELS[invite.role] };
  });
}

export { normaliseEmail };
