import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, createTestApp, makeUser, tokenFromMail, type TestContext } from './helpers';
import { bootstrapOwner } from '../src/bootstrap';
import { loadConfig } from '../src/config';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

describe('sign in and sessions', () => {
  it('rejects a wrong password with a generic message', async () => {
    await makeUser(ctx, 'ada@example.com', 'Ada');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'ada@example.com', password: 'nope-nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects an unknown email the same way', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'nobody@example.com', password: 'password123' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });

  it('signs in with an httpOnly cookie and reports the current user', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'ADA@example.com ', password: 'password123' } });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const cookie = cookieFrom(res);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('ada@example.com');
    expect(me.json().user).not.toHaveProperty('password_hash');
  });

  it('requires a session for /me and clears it on sign-out', async () => {
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'ada@example.com', password: 'password123' } });
    const cookie = cookieFrom(res);
    const out = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    const after = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('ignores a tampered cookie', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: 'wr_session=abc.def' } });
    expect(res.statusCode).toBe(401);
  });

  it('blocks state-changing requests from another origin', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'ada@example.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { origin: ctx.appOrigin },
      payload: { email: 'ada@example.com', password: 'password123' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('password reset', () => {
  it('answers the same for unknown emails and sends nothing', async () => {
    ctx.mailer.clear();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'ghost@example.com' } });
    expect(res.statusCode).toBe(200);
    expect(ctx.mailer.messages).toHaveLength(0);
  });

  it('emails a single-use link that sets a new password and signs out old sessions', async () => {
    const old = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'ada@example.com', password: 'password123' } });
    const oldCookie = cookieFrom(old);

    ctx.mailer.clear();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'ada@example.com' } });
    expect(res.statusCode).toBe(200);
    expect(ctx.mailer.messages).toHaveLength(1);
    expect(ctx.mailer.last()!.to).toBe('ada@example.com');
    const token = tokenFromMail(ctx, 'reset-password');

    const short = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'short' } });
    expect(short.statusCode).toBe(400);

    const reset = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'brand-new-pass' } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().user.email).toBe('ada@example.com');
    const newCookie = cookieFrom(reset);

    // old password no longer works, new one does, old session is gone, new session works
    const oldPw = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'ada@example.com', password: 'password123' } });
    expect(oldPw.statusCode).toBe(401);
    const newPw = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'ada@example.com', password: 'brand-new-pass' } });
    expect(newPw.statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: oldCookie } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: newCookie } })).statusCode).toBe(200);

    // the link is single-use
    const again = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'another-pass-1' } });
    expect(again.statusCode).toBe(404);
  });

  it('refuses an expired link', async () => {
    ctx.mailer.clear();
    await ctx.app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'ada@example.com' } });
    const token = tokenFromMail(ctx, 'reset-password');
    await ctx.db.query(`update password_resets set expires_at = now() - interval '1 minute'`);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'another-pass-1' } });
    expect(res.statusCode).toBe(410);
  });
});

describe('bootstrap owner', () => {
  it('creates the first account from the environment exactly once', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused',
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
      BOOTSTRAP_OWNER_EMAIL: 'Boss@Example.com',
      BOOTSTRAP_OWNER_NAME: 'Boss',
      BOOTSTRAP_OWNER_PASSWORD: 'bootstrap-pass',
    });
    const logs: string[] = [];
    await bootstrapOwner(ctx.db, config, (m) => logs.push(m));
    await bootstrapOwner(ctx.db, config, (m) => logs.push(m));
    expect(logs).toHaveLength(1);
    const { rows } = await ctx.db.query(`select count(*)::int as n from users where email = 'boss@example.com'`);
    expect(rows[0].n).toBe(1);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email: 'boss@example.com', password: 'bootstrap-pass' } });
    expect(res.statusCode).toBe(200);
  });
});
