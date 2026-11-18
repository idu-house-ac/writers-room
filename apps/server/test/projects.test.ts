import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, createProject, createTestApp, makeUser, tokenFromMail, type TestContext } from './helpers';

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof makeUser>>;
let stranger: Awaited<ReturnType<typeof makeUser>>;
let projectId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await makeUser(ctx, 'amadin@example.com', 'Amadin');
  stranger = await makeUser(ctx, 'stranger@example.com', 'Stranger');
  projectId = (await createProject(ctx, owner.cookie, 'Night Shift')).id;
  await createProject(ctx, owner.cookie, 'Second Script', 'tv_single');
});
afterAll(() => ctx.close());

const get = (url: string, cookie: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: unknown) => ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const patch = (url: string, cookie: string, payload?: unknown) => ctx.app.inject({ method: 'PATCH', url, headers: { cookie }, payload });
const del = (url: string, cookie: string) => ctx.app.inject({ method: 'DELETE', url, headers: { cookie } });

describe('projects dashboard', () => {
  it('lists only the projects the caller belongs to, newest first', async () => {
    const mine = await get('/api/projects', owner.cookie);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().projects.map((p: { title: string }) => p.title)).toEqual(['Second Script', 'Night Shift']);
    expect(mine.json().projects[0].myRole).toBe('owner');
    expect(mine.json().projects[0].members).toHaveLength(1);

    const theirs = await get('/api/projects', stranger.cookie);
    expect(theirs.json().projects).toEqual([]);
  });

  it('hides a project from non-members with 404', async () => {
    expect((await get(`/api/projects/${projectId}`, stranger.cookie)).statusCode).toBe(404);
    expect((await patch(`/api/projects/${projectId}`, stranger.cookie, { title: 'x' })).statusCode).toBe(404);
  });

  it('validates new projects', async () => {
    expect((await post('/api/projects', owner.cookie, { title: '', formatProfile: 'feature' })).statusCode).toBe(400);
    expect((await post('/api/projects', owner.cookie, { title: 'x', formatProfile: 'stage_play' })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'x', formatProfile: 'feature' } })).statusCode).toBe(401);
  });

  it('archives and unarchives (owner only) and hides archived projects by default', async () => {
    const archived = await post(`/api/projects/${projectId}/archive`, owner.cookie);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().project.archivedAt).not.toBeNull();
    const list = await get('/api/projects', owner.cookie);
    expect(list.json().projects.map((p: { title: string }) => p.title)).toEqual(['Second Script']);
    const withArchived = await get('/api/projects?archived=1', owner.cookie);
    expect(withArchived.json().projects).toHaveLength(2);
    expect((await post(`/api/projects/${projectId}/unarchive`, owner.cookie)).statusCode).toBe(200);
  });
});

describe('invites and roles', () => {
  let writer: { cookie: string; id: string };
  let commenter: { cookie: string; id: string };

  it('lets an Owner invite by email; the invitee creates an account and sees only that project', async () => {
    ctx.mailer.clear();
    const res = await post(`/api/projects/${projectId}/invites`, owner.cookie, { email: 'Aaron@Example.com', role: 'writer' });
    expect(res.statusCode).toBe(201);
    expect(res.json().invites).toHaveLength(1);
    expect(res.json().invites[0].email).toBe('aaron@example.com');
    expect(ctx.mailer.messages).toHaveLength(1);
    expect(ctx.mailer.last()!.to).toBe('aaron@example.com');
    expect(ctx.mailer.last()!.subject).toContain('Night Shift');
    const token = tokenFromMail(ctx, 'invite');

    const preview = await ctx.app.inject({ method: 'GET', url: `/api/auth/invites/${token}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().invite).toMatchObject({
      email: 'aaron@example.com',
      role: 'writer',
      project: { id: projectId, title: 'Night Shift' },
      invitedBy: { name: 'Amadin' },
      accountExists: false,
      expired: false,
    });

    const missingName = await ctx.app.inject({ method: 'POST', url: `/api/auth/invites/${token}/accept`, payload: { password: 'password123' } });
    expect(missingName.statusCode).toBe(400);

    const accept = await ctx.app.inject({ method: 'POST', url: `/api/auth/invites/${token}/accept`, payload: { name: 'Aaron', password: 'password123' } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().projectId).toBe(projectId);
    writer = { cookie: cookieFrom(accept), id: accept.json().user.id };

    const list = await get('/api/projects', writer.cookie);
    expect(list.json().projects.map((p: { title: string; myRole: string }) => [p.title, p.myRole])).toEqual([['Night Shift', 'writer']]);

    // single use
    const again = await ctx.app.inject({ method: 'POST', url: `/api/auth/invites/${token}/accept`, payload: { name: 'Aaron', password: 'password123' } });
    expect(again.statusCode).toBe(404);
    // no longer pending for the owner
    const detail = await get(`/api/projects/${projectId}`, owner.cookie);
    expect(detail.json().project.invites).toEqual([]);
    expect(detail.json().project.members).toHaveLength(2);
  });

  it('invites an existing account, which must sign in to accept', async () => {
    ctx.mailer.clear();
    await post(`/api/projects/${projectId}/invites`, owner.cookie, { email: 'stranger@example.com', role: 'commenter' });
    const token = tokenFromMail(ctx, 'invite');
    const preview = await ctx.app.inject({ method: 'GET', url: `/api/auth/invites/${token}` });
    expect(preview.json().invite.accountExists).toBe(true);

    const noPw = await ctx.app.inject({ method: 'POST', url: `/api/auth/invites/${token}/accept`, payload: {} });
    expect(noPw.statusCode).toBe(401);
    expect(noPw.json().error.code).toBe('sign_in_required');

    const wrongPw = await ctx.app.inject({ method: 'POST', url: `/api/auth/invites/${token}/accept`, payload: { password: 'wrong-password' } });
    expect(wrongPw.statusCode).toBe(401);

    // signed in as that person: accepted straight away
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/auth/invites/${token}/accept`, headers: { cookie: stranger.cookie }, payload: {} });
    expect(ok.statusCode).toBe(200);
    commenter = { cookie: stranger.cookie, id: stranger.id };
    const list = await get('/api/projects', commenter.cookie);
    expect(list.json().projects[0].myRole).toBe('commenter');
  });

  it('refuses to invite an existing member and refreshes a pending invite instead of duplicating it', async () => {
    const dup = await post(`/api/projects/${projectId}/invites`, owner.cookie, { email: 'aaron@example.com', role: 'reader' });
    expect(dup.statusCode).toBe(409);

    ctx.mailer.clear();
    const first = await post(`/api/projects/${projectId}/invites`, owner.cookie, { email: 'reader@example.com', role: 'reader' });
    expect(first.statusCode).toBe(201);
    const firstToken = tokenFromMail(ctx, 'invite');
    const second = await post(`/api/projects/${projectId}/invites`, owner.cookie, { email: 'reader@example.com', role: 'commenter' });
    expect(second.statusCode).toBe(200);
    expect(second.json().invites.filter((i: { email: string }) => i.email === 'reader@example.com')).toHaveLength(1);
    expect(second.json().invites.find((i: { email: string }) => i.email === 'reader@example.com').role).toBe('commenter');
    expect(ctx.mailer.messages).toHaveLength(2);
    // the first link stops working once a new one is sent
    expect((await ctx.app.inject({ method: 'GET', url: `/api/auth/invites/${firstToken}` })).statusCode).toBe(404);
  });

  it('resends and revokes pending invites', async () => {
    const detail = await get(`/api/projects/${projectId}`, owner.cookie);
    const invite = detail.json().project.invites.find((i: { email: string }) => i.email === 'reader@example.com');
    ctx.mailer.clear();
    const resend = await post(`/api/projects/${projectId}/invites/${invite.id}/resend`, owner.cookie);
    expect(resend.statusCode).toBe(200);
    expect(ctx.mailer.messages).toHaveLength(1);
    const token = tokenFromMail(ctx, 'invite');
    const revoke = await del(`/api/projects/${projectId}/invites/${invite.id}`, owner.cookie);
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().invites).toEqual([]);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/auth/invites/${token}` })).statusCode).toBe(404);
  });

  it('rejects an expired invite with 410', async () => {
    ctx.mailer.clear();
    await post(`/api/projects/${projectId}/invites`, owner.cookie, { email: 'late@example.com', role: 'reader' });
    const token = tokenFromMail(ctx, 'invite');
    await ctx.db.query(`update invites set expires_at = now() - interval '1 minute' where email = 'late@example.com'`);
    const preview = await ctx.app.inject({ method: 'GET', url: `/api/auth/invites/${token}` });
    expect(preview.json().invite.expired).toBe(true);
    const accept = await ctx.app.inject({ method: 'POST', url: `/api/auth/invites/${token}/accept`, payload: { name: 'Late', password: 'password123' } });
    expect(accept.statusCode).toBe(410);
  });

  it('enforces the permissions table on the server', async () => {
    // Writer: can edit, cannot manage members or archive.
    expect((await patch(`/api/projects/${projectId}`, writer.cookie, { title: 'Night Shift (v2)' })).statusCode).toBe(200);
    expect((await post(`/api/projects/${projectId}/invites`, writer.cookie, { email: 'x@example.com', role: 'reader' })).statusCode).toBe(403);
    expect((await get(`/api/projects/${projectId}/invites`, writer.cookie)).statusCode).toBe(403);
    expect((await patch(`/api/projects/${projectId}/members/${commenter.id}`, writer.cookie, { role: 'reader' })).statusCode).toBe(403);
    expect((await post(`/api/projects/${projectId}/archive`, writer.cookie)).statusCode).toBe(403);
    expect((await post(`/api/projects/${projectId}/duplicate`, writer.cookie)).statusCode).toBe(201);

    // Commenter: can read, cannot edit.
    expect((await get(`/api/projects/${projectId}`, commenter.cookie)).statusCode).toBe(200);
    expect((await get(`/api/projects/${projectId}`, commenter.cookie)).json().project.invites).toEqual([]);
    expect((await patch(`/api/projects/${projectId}`, commenter.cookie, { title: 'nope' })).statusCode).toBe(403);
    expect((await post(`/api/projects/${projectId}/duplicate`, commenter.cookie)).statusCode).toBe(403);

    // Owner changes roles and removes people.
    const demote = await patch(`/api/projects/${projectId}/members/${commenter.id}`, owner.cookie, { role: 'reader' });
    expect(demote.statusCode).toBe(200);
    expect((await get(`/api/projects/${projectId}`, commenter.cookie)).json().project.myRole).toBe('reader');

    // Reader still reads but cannot edit.
    expect((await patch(`/api/projects/${projectId}`, commenter.cookie, { title: 'nope' })).statusCode).toBe(403);

    const remove = await del(`/api/projects/${projectId}/members/${commenter.id}`, owner.cookie);
    expect(remove.statusCode).toBe(200);
    expect((await get(`/api/projects/${projectId}`, commenter.cookie)).statusCode).toBe(404);
  });

  it('never leaves a project without an Owner', async () => {
    expect((await patch(`/api/projects/${projectId}/members/${owner.id}`, owner.cookie, { role: 'writer' })).statusCode).toBe(400);
    expect((await del(`/api/projects/${projectId}/members/${owner.id}`, owner.cookie)).statusCode).toBe(400);
    // promote the writer, then the original owner may step down
    expect((await patch(`/api/projects/${projectId}/members/${writer.id}`, owner.cookie, { role: 'owner' })).statusCode).toBe(200);
    expect((await patch(`/api/projects/${projectId}/members/${owner.id}`, owner.cookie, { role: 'writer' })).statusCode).toBe(200);
    expect((await get(`/api/projects/${projectId}`, owner.cookie)).json().project.myRole).toBe('writer');
    // and the new owner can hand it back
    expect((await patch(`/api/projects/${projectId}/members/${owner.id}`, writer.cookie, { role: 'owner' })).statusCode).toBe(200);
  });

  it('lets a non-owner leave a project', async () => {
    const leave = await del(`/api/projects/${projectId}/members/${writer.id}`, writer.cookie);
    // writer is currently an owner too (promoted above), so leaving is allowed only because another owner remains
    expect(leave.statusCode).toBe(204);
    expect((await get(`/api/projects/${projectId}`, writer.cookie)).statusCode).toBe(404);
  });
});
