import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Comment, CommentThread, Notification, NotificationPayload, NotificationType, UserSummary } from '@writers-room/shared';
import type { AppContext } from '../app';
import type { Queryable } from '../db';
import { forbidden, notFound, parseBody } from '../errors';
import { requireUser } from '../plugins/auth';
import { getRole, requireAction } from '../permissions';

const USER_JSON = (alias: string) =>
  `json_build_object('id', ${alias}.id, 'name', ${alias}.name, 'email', ${alias}.email, 'avatarUrl', ${alias}.avatar_url, 'colour', ${alias}.colour)`;

const bodySchema = z.string().trim().min(1, 'Write something first.').max(5000);
const mentionsSchema = z.array(z.uuid()).max(50).default([]);

interface ThreadRow {
  id: string;
  project_id: string;
  anchor_start: string;
  anchor_end: string;
  quoted_text: string;
  status: CommentThread['status'];
  created_at: Date;
  resolved_at: Date | null;
  creator: UserSummary;
  resolver: UserSummary | null;
  comments: (Omit<Comment, 'createdAt' | 'editedAt'> & { createdAt: string; editedAt: string | null })[];
}

async function loadThreads(db: Queryable, projectId: string, threadId?: string): Promise<CommentThread[]> {
  const { rows } = await db.query<ThreadRow>(
    `select t.id, t.project_id, t.anchor_start, t.anchor_end, t.quoted_text, t.status, t.created_at, t.resolved_at,
            ${USER_JSON('cu')} as creator,
            case when ru.id is null then null else ${USER_JSON('ru')} end as resolver,
            coalesce((
              select json_agg(json_build_object(
                       'id', c.id, 'threadId', c.thread_id, 'author', ${USER_JSON('au')}, 'body', c.body,
                       'mentions', c.mentions, 'createdAt', c.created_at, 'editedAt', c.edited_at) order by c.created_at)
                from comments c join users au on au.id = c.author_id where c.thread_id = t.id), '[]'::json) as comments
       from comment_threads t
       join users cu on cu.id = t.created_by
       left join users ru on ru.id = t.resolved_by
      where t.project_id = $1 and ($2::uuid is null or t.id = $2)
      order by t.created_at`,
    [projectId, threadId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    anchorStart: r.anchor_start,
    anchorEnd: r.anchor_end,
    quotedText: r.quoted_text,
    status: r.status,
    createdBy: r.creator,
    createdAt: r.created_at.toISOString(),
    resolvedBy: r.resolver,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    comments: r.comments.map((c) => ({ ...c, createdAt: new Date(c.createdAt).toISOString(), editedAt: c.editedAt ? new Date(c.editedAt).toISOString() : null })),
  }));
}

/** Keep only mentions that are members of the project (and not the author). */
async function validMentions(db: Queryable, projectId: string, authorId: string, mentions: string[]): Promise<string[]> {
  if (!mentions.length) return [];
  const { rows } = await db.query<{ user_id: string }>(
    'select user_id from project_members where project_id = $1 and user_id = any($2::uuid[]) and user_id <> $3',
    [projectId, mentions, authorId],
  );
  return rows.map((r) => r.user_id);
}

export async function notify(db: Queryable, userIds: string[], type: NotificationType, payload: NotificationPayload): Promise<void> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await db.query(
    `insert into notifications (user_id, type, payload) select unnest($1::uuid[]), $2, $3::jsonb`,
    [unique, type, JSON.stringify(payload)],
  );
}

/** Tell everyone connected to the project's document that comments changed, so panels refresh at once. */
function broadcast(ctx: AppContext, projectId: string, threadId: string) {
  ctx.collab?.documents.get(projectId)?.broadcastStateless(JSON.stringify({ type: 'comments', threadId }));
}

export async function commentRoutes(app: FastifyInstance, ctx: AppContext) {
  type P = { Params: { id: string } };
  type PT = { Params: { id: string; threadId: string } };
  type PTC = { Params: { id: string; threadId: string; commentId: string } };

  app.get<P>('/projects/:id/comments', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'read');
    return { threads: await loadThreads(ctx.db, request.params.id) };
  });

  app.post<P>('/projects/:id/comments', async (request, reply) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'comment');
    const body = parseBody(
      z.object({
        anchorStart: z.string().min(1),
        anchorEnd: z.string().min(1),
        quotedText: z.string().max(2000).default(''),
        body: bodySchema,
        mentions: mentionsSchema,
      }),
      request.body,
    );
    const mentions = await validMentions(ctx.db, request.params.id, user.id, body.mentions);
    const { rows } = await ctx.db.query<{ id: string }>(
      `insert into comment_threads (project_id, anchor_start, anchor_end, quoted_text, created_by) values ($1, $2, $3, $4, $5) returning id`,
      [request.params.id, body.anchorStart, body.anchorEnd, body.quotedText, user.id],
    );
    const threadId = rows[0]!.id;
    await ctx.db.query(`insert into comments (thread_id, author_id, body, mentions) values ($1, $2, $3, $4)`, [threadId, user.id, body.body, mentions]);
    const { rows: pr } = await ctx.db.query<{ title: string }>('select title from projects where id = $1', [request.params.id]);
    await notify(ctx.db, mentions, 'mention', {
      projectId: request.params.id,
      projectTitle: pr[0]?.title ?? '',
      threadId,
      actor: { id: user.id, name: user.name },
      excerpt: body.body.slice(0, 140),
    });
    broadcast(ctx, request.params.id, threadId);
    reply.code(201);
    return { thread: (await loadThreads(ctx.db, request.params.id, threadId))[0] };
  });

  app.post<PT>('/projects/:id/comments/:threadId/replies', async (request, reply) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'comment');
    const body = parseBody(z.object({ body: bodySchema, mentions: mentionsSchema }), request.body);
    const thread = (await loadThreads(ctx.db, request.params.id, request.params.threadId))[0];
    if (!thread) throw notFound('Comment thread not found.');
    const mentions = await validMentions(ctx.db, request.params.id, user.id, body.mentions);
    await ctx.db.query(`insert into comments (thread_id, author_id, body, mentions) values ($1, $2, $3, $4)`, [thread.id, user.id, body.body, mentions]);
    const { rows: pr } = await ctx.db.query<{ title: string }>('select title from projects where id = $1', [request.params.id]);
    const payload: NotificationPayload = {
      projectId: request.params.id,
      projectTitle: pr[0]?.title ?? '',
      threadId: thread.id,
      actor: { id: user.id, name: user.name },
      excerpt: body.body.slice(0, 140),
    };
    await notify(ctx.db, mentions, 'mention', payload);
    // Everyone who took part in the thread hears about the reply, unless they were just mentioned.
    const participants = [thread.createdBy.id, ...thread.comments.map((c) => c.author.id)].filter((id) => id !== user.id && !mentions.includes(id));
    await notify(ctx.db, participants, 'reply', payload);
    broadcast(ctx, request.params.id, thread.id);
    reply.code(201);
    return { thread: (await loadThreads(ctx.db, request.params.id, thread.id))[0] };
  });

  // Resolve or reopen.
  app.patch<PT>('/projects/:id/comments/:threadId', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'comment');
    const body = parseBody(z.object({ status: z.enum(['open', 'resolved']) }), request.body);
    const { rowCount } = await ctx.db.query(
      `update comment_threads set status = $3::thread_status,
              resolved_by = case when $3::text = 'resolved' then $4::uuid else null end,
              resolved_at = case when $3::text = 'resolved' then now() else null end
        where id = $1 and project_id = $2`,
      [request.params.threadId, request.params.id, body.status, user.id],
    );
    if (!rowCount) throw notFound('Comment thread not found.');
    broadcast(ctx, request.params.id, request.params.threadId);
    return { thread: (await loadThreads(ctx.db, request.params.id, request.params.threadId))[0] };
  });

  // Edit your own comment.
  app.patch<PTC>('/projects/:id/comments/:threadId/replies/:commentId', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'comment');
    const body = parseBody(z.object({ body: bodySchema, mentions: mentionsSchema }), request.body);
    const { rows } = await ctx.db.query<{ author_id: string }>(
      `select c.author_id from comments c join comment_threads t on t.id = c.thread_id where c.id = $1 and t.id = $2 and t.project_id = $3`,
      [request.params.commentId, request.params.threadId, request.params.id],
    );
    if (!rows[0]) throw notFound('Comment not found.');
    if (rows[0].author_id !== user.id) throw forbidden('You can only edit your own comments.');
    const mentions = await validMentions(ctx.db, request.params.id, user.id, body.mentions);
    await ctx.db.query('update comments set body = $2, mentions = $3, edited_at = now() where id = $1', [request.params.commentId, body.body, mentions]);
    broadcast(ctx, request.params.id, request.params.threadId);
    return { thread: (await loadThreads(ctx.db, request.params.id, request.params.threadId))[0] };
  });

  // Delete your own comment; Owners may delete anyone's. A thread with no comments left is removed.
  app.delete<PTC>('/projects/:id/comments/:threadId/replies/:commentId', async (request) => {
    const user = requireUser(request);
    const role = await requireAction(ctx.db, request.params.id, user.id, 'comment');
    const { rows } = await ctx.db.query<{ author_id: string }>(
      `select c.author_id from comments c join comment_threads t on t.id = c.thread_id where c.id = $1 and t.id = $2 and t.project_id = $3`,
      [request.params.commentId, request.params.threadId, request.params.id],
    );
    if (!rows[0]) throw notFound('Comment not found.');
    if (rows[0].author_id !== user.id && role !== 'owner') throw forbidden('You can only delete your own comments.');
    await ctx.db.query('delete from comments where id = $1', [request.params.commentId]);
    await ctx.db.query('delete from comment_threads where id = $1 and not exists (select 1 from comments where thread_id = $1)', [request.params.threadId]);
    broadcast(ctx, request.params.id, request.params.threadId);
    const thread = (await loadThreads(ctx.db, request.params.id, request.params.threadId))[0] ?? null;
    return { thread };
  });

  // ---- Notifications (per user) ----

  app.get('/notifications', async (request) => {
    const user = requireUser(request);
    const { rows } = await ctx.db.query<{ id: string; type: NotificationType; payload: NotificationPayload; read_at: Date | null; created_at: Date }>(
      'select id, type, payload, read_at, created_at from notifications where user_id = $1 order by created_at desc limit 50',
      [user.id],
    );
    const { rows: unread } = await ctx.db.query<{ n: string }>('select count(*)::text as n from notifications where user_id = $1 and read_at is null', [user.id]);
    const notifications: Notification[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      readAt: r.read_at ? r.read_at.toISOString() : null,
      createdAt: r.created_at.toISOString(),
    }));
    return { notifications, unread: Number(unread[0]?.n ?? 0) };
  });

  app.post('/notifications/read', async (request) => {
    const user = requireUser(request);
    const body = parseBody(z.object({ ids: z.array(z.uuid()).optional() }), request.body);
    if (body.ids?.length) await ctx.db.query('update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null', [user.id, body.ids]);
    else await ctx.db.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [user.id]);
    return { ok: true };
  });

  // Exposed for tests: role lookup used by the UI to decide what to show (server still enforces).
  void getRole;
}
