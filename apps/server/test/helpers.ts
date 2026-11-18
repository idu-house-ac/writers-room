import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDb, resetDatabase, type Db } from '../src/db';
import { MemoryMailer } from '../src/mail';
import { createUser } from '../src/users';
import { createCollabServer } from '../src/collab';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/writers_room_test';

export interface TestContext {
  app: FastifyInstance;
  collab: ReturnType<typeof createCollabServer>;
  db: Db;
  mailer: MemoryMailer;
  appOrigin: string;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    APP_ORIGIN: 'http://localhost:5173',
    MAIL_TRANSPORT: 'memory',
  });
  const db = createDb(config.DATABASE_URL);
  await resetDatabase(db);
  const mailer = new MemoryMailer();
  const collab = createCollabServer({ config, db }, { debounce: 50, maxDebounce: 100, quiet: true });
  const app = await buildApp({ config, db, mailer, rateLimit: false, collab }, { logger: false });
  await app.ready();
  return {
    app,
    db,
    mailer,
    appOrigin: config.APP_ORIGIN,
    collab,
    close: async () => {
      collab.closeConnections();
      await app.close();
      await db.end();
    },
  };
}

/** The session cookie from a response, ready to send back in a `cookie` header. */
export function cookieFrom(res: LightMyRequestResponse): string {
  const header = res.headers['set-cookie'];
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const session = list.find((c) => c.startsWith('wr_session='));
  if (!session) throw new Error('No session cookie in response');
  return session.split(';')[0]!;
}

export async function makeUser(ctx: TestContext, email: string, name = email.split('@')[0]!, password = 'password123') {
  const user = await createUser(ctx.db, { email, name, password });
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.body}`);
  return { ...user, password, cookie: cookieFrom(res) };
}

export async function createProject(ctx: TestContext, cookie: string, title = 'Untitled', formatProfile = 'feature') {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { title, formatProfile } });
  if (res.statusCode !== 201) throw new Error(`create project failed: ${res.body}`);
  return res.json().project as { id: string; title: string };
}

/** Pull the token out of the last emailed link, e.g. .../invite/<token> or .../reset-password/<token>. */
export function tokenFromMail(ctx: TestContext, pathPart: 'invite' | 'reset-password'): string {
  const mail = ctx.mailer.last();
  if (!mail) throw new Error('No mail was sent');
  const match = mail.text.match(new RegExp(`${ctx.appOrigin}/${pathPart}/([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`No ${pathPart} link in mail:\n${mail.text}`);
  return match[1]!;
}
