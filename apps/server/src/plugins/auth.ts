import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db';
import { unauthorized } from '../errors';
import { loadSession, readSessionId, type UserRow } from '../auth/session';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionId: string | null;
  }
}

/** Loads the signed-in user from the session cookie on every request, and blocks cross-site writes.
 *  Applied to the root instance (not as an encapsulated plugin) so every route context inherits it. */
export function setupAuth(app: FastifyInstance, opts: { config: Config; db: Db }): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request, reply) => {
    // CSRF: cookies are SameSite=Lax, and any state-changing request that carries an Origin header
    // must come from our own web origin.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && origin !== opts.config.APP_ORIGIN && origin !== `${request.protocol}://${request.host}`) {
        return reply.code(403).send({ error: { code: 'bad_origin', message: 'Cross-site request blocked.' } });
      }
    }
    const sessionId = readSessionId(request);
    if (!sessionId) return;
    const user = await loadSession(opts.db, sessionId);
    if (user) {
      request.user = user;
      request.sessionId = sessionId;
    }
  });
}

export function requireUser(request: FastifyRequest): UserRow {
  if (!request.user) throw unauthorized();
  return request.user;
}
