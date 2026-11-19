import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import type { Config } from './config';
import type { Db } from './db';
import { HttpError, sendError } from './errors';
import type { Mailer } from './mail';
import { setupAuth } from './plugins/auth';
import { authRoutes } from './routes/auth';
import { projectRoutes } from './routes/projects';
import { commentRoutes } from './routes/comments';
import { snapshotRoutes } from './routes/snapshots';
import { presenceOf, type CollabServer } from './collab';
import websocket from '@fastify/websocket';
import { requireUser } from './plugins/auth';

export interface AppContext {
  config: Config;
  db: Db;
  mailer: Mailer;
  /** Rate limiting is on everywhere except in automated tests. */
  rateLimit: boolean;
  /** The collaboration server; mounted at /collab and used for presence lookups. */
  collab?: CollabServer;
}

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const dev = ctx.config.NODE_ENV === 'development';
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : dev
          ? { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
          : { level: 'info' },
    trustProxy: true,
  });

  await app.register(cookie, { secret: ctx.config.SESSION_SECRET });
  await app.register(cors, { origin: ctx.config.APP_ORIGIN, credentials: true });
  if (ctx.rateLimit) {
    await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  }
  setupAuth(app, { config: ctx.config, db: ctx.db });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // Live co-writing: WebSocket connections at /collab are handed to Hocuspocus, which authenticates
  // them from the session cookie (see collab.ts).
  if (ctx.collab) {
    const collab = ctx.collab;
    await app.register(websocket);
    app.get('/collab', { websocket: true }, (socket, request) => {
      // Hocuspocus 4 reads a Fetch-style Request; rebuild one from the upgrade request (cookie included).
      const raw = request.raw;
      const headers = new Headers();
      for (const [name, value] of Object.entries(raw.headers)) {
        if (/^(connection|upgrade|sec-websocket-.*)$/i.test(name) || value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
      }
      const connection = collab.handleConnection(socket, new Request(`http://${raw.headers.host ?? 'localhost'}${raw.url ?? '/collab'}`, { headers }));
      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        connection.handleMessage(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      });
      socket.on('close', (code: number, reason: Buffer) =>
        connection.handleClose({ code, reason: reason.toString() } as Parameters<typeof connection.handleClose>[0]),
      );
      socket.on('pong', () => connection.touch());
    });
  }

  app.setErrorHandler((err: unknown, _request, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'error', message: e.message ?? 'Request failed.' } });
    }
    app.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong on the server.' } });
  });

  app.get('/api/health', async () => {
    await ctx.db.query('select 1');
    return { ok: true };
  });

  await app.register(
    async (api) => {
      await authRoutes(api, ctx);
      await projectRoutes(api, ctx);
      await commentRoutes(api, ctx);
      await snapshotRoutes(api, ctx);
      api.get('/presence', async (request) => {
        const user = requireUser(request);
        if (!ctx.collab) return { presence: {} };
        const { rows } = await ctx.db.query<{ project_id: string }>('select project_id from project_members where user_id = $1', [user.id]);
        return { presence: presenceOf(ctx.collab, rows.map((r) => r.project_id)) };
      });
    },
    { prefix: '/api' },
  );

  // Production: serve the built web app and let the client router handle unknown paths.
  if (ctx.config.WEB_DIST) {
    const root = path.resolve(ctx.config.WEB_DIST);
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }
      return reply.sendFile('index.html', root);
    });
  }

  return app;
}
