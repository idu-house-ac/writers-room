import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue.', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = 'Your role does not allow that.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);
export const gone = (message: string) => new HttpError(410, 'gone', message);

export function sendError(reply: FastifyReply, err: HttpError) {
  return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
}

/** Validate a request body with a zod schema; throws a 400 with the issues on failure. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = details[0];
    throw badRequest(first ? `${first.path ? first.path + ': ' : ''}${first.message}` : 'Invalid request.', details);
  }
  return result.data;
}
