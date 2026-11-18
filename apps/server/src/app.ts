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

export interface AppContext {
  config: Config;
  db: Db;
  mailer: Mailer;
  /** Rate limiting is on everywhere except in automated tests. */
  rateLimit: boolean;
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
