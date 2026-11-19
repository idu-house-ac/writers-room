import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as Y from 'yjs';
import type { AppContext } from '../app';
import { loadDoc, writeDoc } from '../docs';
import { badRequest, notFound, parseBody } from '../errors';
import { requireUser } from '../plugins/auth';
import { requireAction } from '../permissions';
import { applyScript, detachedThreadIds, getSnapshot, listSnapshots, takeSnapshot } from '../snapshots';
import type { FormatProfileId } from '@writers-room/shared';

type P = { Params: { id: string } };
type PS = { Params: { id: string; snapshotId: string } };

export async function snapshotRoutes(app: FastifyInstance, ctx: AppContext) {
  const profileOf = async (projectId: string): Promise<FormatProfileId> => {
    const { rows } = await ctx.db.query<{ format_profile: FormatProfileId }>('select format_profile from projects where id = $1', [projectId]);
    return rows[0]?.format_profile ?? 'feature';
  };

  /** The live document: the collaboration server's copy when loaded, else the stored state. */
  const withLiveDoc = async <T>(projectId: string, fn: (ydoc: Y.Doc, live: boolean) => Promise<T>): Promise<T> => {
    const loaded = ctx.collab?.documents.get(projectId);
    if (loaded) return fn(loaded, true);
    const stored = await loadDoc(ctx.db, projectId);
    const ydoc = new Y.Doc();
    if (stored) Y.applyUpdate(ydoc, stored.state);
    return fn(ydoc, false);
  };

  app.get<P>('/projects/:id/snapshots', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'read');
    return { snapshots: await listSnapshots(ctx.db, request.params.id) };
  });

  app.get<PS>('/projects/:id/snapshots/:snapshotId', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'read');
    const snapshot = await getSnapshot(ctx.db, request.params.id, request.params.snapshotId);
    if (!snapshot) throw notFound('Version not found.');
    return { snapshot };
  });

  // Name the current state as a draft.
  app.post<P>('/projects/:id/snapshots', async (request, reply) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'name_draft');
    const body = parseBody(z.object({ name: z.string().trim().min(1, 'Give the draft a name.').max(120) }), request.body);
    const profile = await profileOf(request.params.id);
    const id = await withLiveDoc(request.params.id, (ydoc) =>
      takeSnapshot(ctx.db, request.params.id, ydoc, { kind: 'named', name: body.name, createdBy: user.id, authors: [user.id], profile }),
    );
    reply.code(201);
    return { snapshots: await listSnapshots(ctx.db, request.params.id), id };
  });

  /**
   * Restore: save a "before restore" copy, then apply the old version to the live script as one
   * ordinary edit through the collaboration server, so everyone connected receives it. The stored
   * document is never overwritten underneath connected users.
   */
  app.post<PS>('/projects/:id/snapshots/:snapshotId/restore', async (request) => {
    const user = requireUser(request);
    await requireAction(ctx.db, request.params.id, user.id, 'restore_version');
    const projectId = request.params.id;
    const snapshot = await getSnapshot(ctx.db, projectId, request.params.snapshotId);
    if (!snapshot) throw notFound('Version not found.');
    if (!ctx.collab) throw badRequest('Restore needs the collaboration server.');
    const profile = await profileOf(projectId);

    const connection = await ctx.collab.openDirectConnection(projectId, { user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url, colour: user.colour }, role: 'writer' });
    try {
      const live = connection.document!;
      await takeSnapshot(ctx.db, projectId, live, { kind: 'pre_restore', createdBy: user.id, authors: [...(ctx.collab.activity.get(projectId)?.authors ?? [])], profile });
      let replaced = 0;
      await connection.transact((document) => {
        replaced = applyScript(document, snapshot.content).replaced;
      });
      // Comments whose text the restore removed: keep them, mark them detached.
      const { rows: threads } = await ctx.db.query<{ id: string; anchor_start: string; anchor_end: string }>(
        `select id, anchor_start, anchor_end from comment_threads where project_id = $1 and status <> 'detached'`,
        [projectId],
      );
      const detached = detachedThreadIds(live, threads);
      if (detached.length) await ctx.db.query(`update comment_threads set status = 'detached' where id = any($1::uuid[])`, [detached]);
      // Persist now rather than after the store debounce, so a crash cannot lose the restore.
      await writeDoc(ctx.db, projectId, live, profile, user.id);
      const a = ctx.collab.activity.get(projectId);
      if (a) {
        a.dirtySince = null;
        a.authors.clear();
        a.lastSnapshotAt = Date.now();
      }
      const label = snapshot.name ?? `the version from ${new Date(snapshot.createdAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`;
      live.broadcastStateless(JSON.stringify({ type: 'restore', by: user.name, label, snapshotId: snapshot.id }));
      live.broadcastStateless(JSON.stringify({ type: 'comments' }));
      return { ok: true, replaced, detached: detached.length, snapshots: await listSnapshots(ctx.db, projectId) };
    } finally {
      await connection.disconnect();
    }
  });
}
