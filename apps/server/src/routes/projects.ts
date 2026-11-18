import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FORMAT_PROFILES,
  ROLE_LABELS,
  ROLES,
  type FormatProfileId,
  type InviteSummary,
  type MemberSummary,
  type ProjectDetail,
  type ProjectSummary,
  type Role,
  type UserSummary,
} from '@writers-room/shared';
import type { AppContext } from '../app';
import { hashToken, randomToken } from '../auth/password';
import type { Queryable } from '../db';
import { badRequest, conflict, notFound, parseBody } from '../errors';
import { inviteEmail } from '../mail';
import { requireUser } from '../plugins/auth';
import { requireAction } from '../permissions';
import { findUserByEmail, normaliseEmail } from '../users';

const INVITE_DAYS = 7;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));
const roleSchema = z.enum(ROLES);
const titleSchema = z.string().trim().min(1, 'Give the project a title.').max(200);

interface ProjectRow {
  id: string;
  title: string;
  format_profile: FormatProfileId;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  my_role: Role;
  last_editor: UserSummary | null;
  members: (UserSummary & { role: Role; addedAt: string })[];
}

const PROJECT_SELECT = `
  select p.id, p.title, p.format_profile, p.created_at, p.updated_at, p.archived_at,
         me.role as my_role,
         case when ue.id is null then null else
           json_build_object('id', ue.id, 'name', ue.name, 'email', ue.email, 'avatarUrl', ue.avatar_url, 'colour', ue.colour)
         end as last_editor,
         coalesce((
           select json_agg(json_build_object(
                    'id', u.id, 'name', u.name, 'email', u.email, 'avatarUrl', u.avatar_url, 'colour', u.colour,
                    'role', m.role, 'addedAt', m.added_at) order by m.added_at)
             from project_members m join users u on u.id = m.user_id
            where m.project_id = p.id), '[]'::json) as members
    from projects p
    join project_members me on me.project_id = p.id and me.user_id = $1
    left join users ue on ue.id = coalesce(p.updated_by, p.created_by)`;

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    formatProfile: row.format_profile,
    myRole: row.my_role,
    pageCount: null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    lastEditedBy: row.last_editor,
    members: row.members.map((m): MemberSummary => ({ ...m, addedAt: new Date(m.addedAt).toISOString() })),
  };
}

async function loadProject(db: Queryable, projectId: string, userId: string): Promise<ProjectSummary> {
  const { rows } = await db.query<ProjectRow>(`${PROJECT_SELECT} where p.id = $2`, [userId, projectId]);
  const row = rows[0];
  if (!row) throw notFound('Project not found.');
  return toSummary(row);
}

interface InviteRow {
  id: string;
  email: string;
  role: Role;
  created_at: Date;
  expires_at: Date;
  inviter: UserSummary;
}

async function loadPendingInvites(db: Queryable, projectId: string): Promise<InviteSummary[]> {
  const { rows } = await db.query<InviteRow>(
    `select i.id, i.email, i.role, i.created_at, i.expires_at,
            json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatarUrl', u.avatar_url, 'colour', u.colour) as inviter
       from invites i join users u on u.id = i.invited_by
      where i.project_id = $1 and i.accepted_at is null and i.revoked_at is null
      order by i.created_at`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    invitedBy: r.inviter,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
  }));
}

async function sendInvite(ctx: AppContext, invite: { id: string; email: string; role: Role }, projectTitle: string, inviterName: string) {
  const token = randomToken();
  await ctx.db.query(
    `update invites set token_hash = $2, expires_at = now() + ($3 || ' days')::interval where id = $1`,
    [invite.id, hashToken(token), String(INVITE_DAYS)],
  );
  await ctx.mailer.send(
    inviteEmail({
      to: invite.email,
      inviterName,
      projectTitle,
      roleLabel: ROLE_LABELS[invite.role],
      link: `${ctx.config.APP_ORIGIN}/invite/${token}`,
      expiresInDays: INVITE_DAYS,
    }),
  );
}

async function assertNotLastOwner(db: Queryable, projectId: string, userId: string) {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from project_members where project_id = $1 and role = 'owner' and user_id <> $2`,
    [projectId, userId],
  );
  if (Number(rows[0]?.n ?? 0) === 0) throw badRequest('A project needs at least one Owner. Make someone else an Owner first.');
}

type IdParams = { Params: { id: string } };

export async function projectRoutes(app: FastifyInstance, ctx: AppContext) {
  // Dashboard list: only projects the caller belongs to.
  app.get<{ Querystring: { archived?: string } }>('/projects', async (request) => {
    const user = requireUser(request);
    const includeArchived = request.query.archived === '1' || request.query.archived === 'true';
    const { rows } = await ctx.db.query<ProjectRow>(
      `${PROJECT_SELECT} where ($2::boolean or p.archived_at is null) order by p.updated_at desc`,
      [user.id, includeArchived],
    );
    return { projects: rows.map(toSummary) };
  });

  app.post('/projects', async (request, reply) => {
    const user = requireUser(request);
    const body = parseBody(z.object({ title: titleSchema, formatProfile: z.enum(FORMAT_PROFILES) }), request.body);
    const { rows } = await ctx.db.query<{ id: string }>(
      `insert into projects (title, format_profile, created_by, updated_by) values ($1, $2, $3, $3) returning id`,
      [body.title, body.formatProfile, user.id],
    );
    const id = rows[0]!.id;
    await ctx.db.query(`insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`, [id, user.id]);
    reply.code(201);
    return { project: await loadProject(ctx.db, id, user.id) };
  });

  app.get<IdParams>('/projects/:id', async (request) => {
    const user = requireUser(request);
    const role = await requireAction(ctx.db, request.params.id, user.id, 'read');
    const project = await loadProject(ctx.db, request.params.id, user.id);
    const detail: ProjectDetail = {
      ...project,
      invites: role === 'owner' ? await loadPendingInvites(ctx.db, project.id) : [],
    };
    return { project: detail };
  });

  app.patch<IdParams>('/projects/:id', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'edit');
    const body = parseBody(z.object({ title: titleSchema }), request.body);
    await ctx.db.query(`update projects set title = $2, updated_by = $3, updated_at = now() where id = $1`, [
      request.params.id,
      body.title,
      user.id,
    ]);
    return { project: await loadProject(ctx.db, request.params.id, user.id) };
  });

  app.post<IdParams>('/projects/:id/archive', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'archive');
    await ctx.db.query(`update projects set archived_at = now() where id = $1 and archived_at is null`, [request.params.id]);
    return { project: await loadProject(ctx.db, request.params.id, user.id) };
  });

  app.post<IdParams>('/projects/:id/unarchive', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'archive');
    await ctx.db.query(`update projects set archived_at = null where id = $1`, [request.params.id]);
    return { project: await loadProject(ctx.db, request.params.id, user.id) };
  });

  // Duplicate copies the project record and makes the caller its Owner.
  // The script document does not exist until M1; copying it is added there.
  app.post<IdParams>('/projects/:id/duplicate', async (request, reply) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'duplicate');
    const source = await loadProject(ctx.db, request.params.id, user.id);
    const { rows } = await ctx.db.query<{ id: string }>(
      `insert into projects (title, format_profile, created_by, updated_by) values ($1, $2, $3, $3) returning id`,
      [`${source.title} (copy)`, source.formatProfile, user.id],
    );
    const id = rows[0]!.id;
    await ctx.db.query(`insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`, [id, user.id]);
    reply.code(201);
    return { project: await loadProject(ctx.db, id, user.id) };
  });

  // ---- Members ----

  app.patch<{ Params: { id: string; userId: string } }>('/projects/:id/members/:userId', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'manage_members');
    const body = parseBody(z.object({ role: roleSchema }), request.body);
    const { rows } = await ctx.db.query<{ role: Role }>(
      'select role from project_members where project_id = $1 and user_id = $2',
      [request.params.id, request.params.userId],
    );
    if (!rows[0]) throw notFound('That person is not a member of this project.');
    if (rows[0].role === 'owner' && body.role !== 'owner') await assertNotLastOwner(ctx.db, request.params.id, request.params.userId);
    await ctx.db.query('update project_members set role = $3 where project_id = $1 and user_id = $2', [
      request.params.id,
      request.params.userId,
      body.role,
    ]);
    return { project: await loadProject(ctx.db, request.params.id, user.id) };
  });

  // Owners remove anyone; anyone may remove themselves (leave), unless they are the last Owner.
  app.delete<{ Params: { id: string; userId: string } }>('/projects/:id/members/:userId', async (request, reply) => {
    const user = requireUser(request);
    const leaving = request.params.userId === user.id;
    await requireAction(ctx.db, request.params.id, user.id, leaving ? 'read' : 'manage_members');
    const { rows } = await ctx.db.query<{ role: Role }>(
      'select role from project_members where project_id = $1 and user_id = $2',
      [request.params.id, request.params.userId],
    );
    if (!rows[0]) throw notFound('That person is not a member of this project.');
    if (rows[0].role === 'owner') await assertNotLastOwner(ctx.db, request.params.id, request.params.userId);
    await ctx.db.query('delete from project_members where project_id = $1 and user_id = $2', [request.params.id, request.params.userId]);
    if (leaving) return reply.code(204).send();
    return { project: await loadProject(ctx.db, request.params.id, user.id) };
  });

  // ---- Invites (Owner only) ----

  app.get<IdParams>('/projects/:id/invites', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'manage_members');
    return { invites: await loadPendingInvites(ctx.db, request.params.id) };
  });

  app.post<IdParams>('/projects/:id/invites', async (request, reply) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'manage_members');
    const body = parseBody(z.object({ email: emailSchema, role: roleSchema }), request.body);
    const project = await loadProject(ctx.db, request.params.id, user.id);

    const existingUser = await findUserByEmail(ctx.db, body.email);
    if (existingUser && project.members.some((m) => m.id === existingUser.id)) {
      throw conflict('That person is already a member of this project.', 'already_member');
    }

    // One pending invite per email per project: re-inviting refreshes the link and resends the email.
    const { rows: pending } = await ctx.db.query<{ id: string }>(
      `select id from invites where project_id = $1 and email = $2 and accepted_at is null and revoked_at is null`,
      [project.id, body.email],
    );
    let inviteId: string;
    if (pending[0]) {
      inviteId = pending[0].id;
      await ctx.db.query('update invites set role = $2, invited_by = $3 where id = $1', [inviteId, body.role, user.id]);
    } else {
      const { rows } = await ctx.db.query<{ id: string }>(
        `insert into invites (email, project_id, role, token_hash, invited_by, expires_at)
         values ($1, $2, $3, $4, $5, now()) returning id`,
        [body.email, project.id, body.role, hashToken(randomToken()), user.id],
      );
      inviteId = rows[0]!.id;
      reply.code(201);
    }
    await sendInvite(ctx, { id: inviteId, email: body.email, role: body.role }, project.title, user.name);
    return { invites: await loadPendingInvites(ctx.db, project.id) };
  });

  app.post<{ Params: { id: string; inviteId: string } }>('/projects/:id/invites/:inviteId/resend', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'manage_members');
    const project = await loadProject(ctx.db, request.params.id, user.id);
    const { rows } = await ctx.db.query<{ id: string; email: string; role: Role }>(
      `select id, email, role from invites where id = $1 and project_id = $2 and accepted_at is null and revoked_at is null`,
      [request.params.inviteId, project.id],
    );
    if (!rows[0]) throw notFound('That invitation is no longer pending.');
    await sendInvite(ctx, rows[0], project.title, user.name);
    return { invites: await loadPendingInvites(ctx.db, project.id) };
  });

  app.delete<{ Params: { id: string; inviteId: string } }>('/projects/:id/invites/:inviteId', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'manage_members');
    await ctx.db.query(
      `update invites set revoked_at = now() where id = $1 and project_id = $2 and accepted_at is null and revoked_at is null`,
      [request.params.inviteId, request.params.id],
    );
    return { invites: await loadPendingInvites(ctx.db, request.params.id) };
  });
}

export { normaliseEmail };
