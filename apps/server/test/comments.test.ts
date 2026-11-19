import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createProject, createTestApp, makeUser, type TestContext } from './helpers';
import { SCRIPT_FIELD } from '../src/docs';

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof makeUser>>;
let writer: Awaited<ReturnType<typeof makeUser>>;
let commenter: Awaited<ReturnType<typeof makeUser>>;
let reader: Awaited<ReturnType<typeof makeUser>>;
let stranger: Awaited<ReturnType<typeof makeUser>>;
let projectId: string;
let port: number;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await makeUser(ctx, 'owner@example.com', 'Owner');
  writer = await makeUser(ctx, 'writer@example.com', 'Writer');
  commenter = await makeUser(ctx, 'commenter@example.com', 'Commenter');
  reader = await makeUser(ctx, 'reader@example.com', 'Reader');
  stranger = await makeUser(ctx, 'stranger@example.com', 'Stranger');
  projectId = (await createProject(ctx, owner.cookie, 'Notes')).id;
  for (const [u, role] of [[writer, 'writer'], [commenter, 'commenter'], [reader, 'reader']] as const) {
    await ctx.db.query(`insert into project_members (project_id, user_id, role) values ($1, $2, $3)`, [projectId, u.id, role]);
  }
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  port = (ctx.app.server.address() as { port: number }).port;
});
afterAll(() => ctx.close());

const get = (url: string, cookie: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: Record<string, unknown>) => ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const patch = (url: string, cookie: string, payload?: Record<string, unknown>) => ctx.app.inject({ method: 'PATCH', url, headers: { cookie }, payload });
const del = (url: string, cookie: string) => ctx.app.inject({ method: 'DELETE', url, headers: { cookie } });
const anchor = { anchorStart: 'AAEC', anchorEnd: 'AAED', quotedText: 'pours coffee' };

describe('comment threads', () => {
  let threadId: string;

  it('a Commenter can start a thread and mention a member, who gets a notification', async () => {
    const res = await post(`/api/projects/${projectId}/comments`, commenter.cookie, { ...anchor, body: 'Too early for coffee? @Writer', mentions: [writer.id, stranger.id] });
    expect(res.statusCode).toBe(201);
    const t = res.json().thread;
    threadId = t.id;
    expect(t.status).toBe('open');
    expect(t.quotedText).toBe('pours coffee');
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].mentions).toEqual([writer.id]); // the stranger is not a member, so dropped
    const n = await get('/api/notifications', writer.cookie);
    expect(n.json().unread).toBe(1);
    expect(n.json().notifications[0]).toMatchObject({ type: 'mention', payload: { projectId, threadId, actor: { name: 'Commenter' } } });
    expect((await get('/api/notifications', stranger.cookie)).json().unread).toBe(0);
  });

  it('replies notify the thread participants, and mentions take precedence', async () => {
    const res = await post(`/api/projects/${projectId}/comments/${threadId}/replies`, writer.cookie, { body: 'Never too early. @Owner thoughts?', mentions: [owner.id] });
    expect(res.statusCode).toBe(201);
    expect(res.json().thread.comments).toHaveLength(2);
    const c = await get('/api/notifications', commenter.cookie);
    expect(c.json().notifications[0]).toMatchObject({ type: 'reply', payload: { threadId, actor: { name: 'Writer' } } });
    const o = await get('/api/notifications', owner.cookie);
    expect(o.json().notifications[0].type).toBe('mention');
    expect(o.json().unread).toBe(1);
    // the author of the reply gets nothing
    expect((await get('/api/notifications', writer.cookie)).json().unread).toBe(1); // still only the earlier mention
  });

  it('marks notifications read', async () => {
    const before = await get('/api/notifications', owner.cookie);
    const id = before.json().notifications[0].id;
    expect((await post('/api/notifications/read', owner.cookie, { ids: [id] })).statusCode).toBe(200);
    expect((await get('/api/notifications', owner.cookie)).json().unread).toBe(0);
    await post('/api/notifications/read', commenter.cookie, {});
    expect((await get('/api/notifications', commenter.cookie)).json().unread).toBe(0);
  });

  it('resolves and reopens', async () => {
    const r = await patch(`/api/projects/${projectId}/comments/${threadId}`, owner.cookie, { status: 'resolved' });
    expect(r.statusCode).toBe(200);
    expect(r.json().thread.status).toBe('resolved');
    expect(r.json().thread.resolvedBy.name).toBe('Owner');
    const o = await patch(`/api/projects/${projectId}/comments/${threadId}`, commenter.cookie, { status: 'open' });
    expect(o.json().thread.status).toBe('open');
    expect(o.json().thread.resolvedBy).toBeNull();
  });

  it('lets authors edit and delete their own comments, and Owners delete anyone\'s', async () => {
    const list = await get(`/api/projects/${projectId}/comments`, owner.cookie);
    const thread = list.json().threads.find((t: { id: string }) => t.id === threadId);
    const [first, second] = thread.comments;
    expect((await patch(`/api/projects/${projectId}/comments/${threadId}/replies/${second.id}`, commenter.cookie, { body: 'x' })).statusCode).toBe(403);
    const edited = await patch(`/api/projects/${projectId}/comments/${threadId}/replies/${second.id}`, writer.cookie, { body: 'Never too early, edited.' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().thread.comments[1]).toMatchObject({ body: 'Never too early, edited.' });
    expect(edited.json().thread.comments[1].editedAt).not.toBeNull();
    expect((await del(`/api/projects/${projectId}/comments/${threadId}/replies/${first.id}`, writer.cookie)).statusCode).toBe(403);
    expect((await del(`/api/projects/${projectId}/comments/${threadId}/replies/${second.id}`, owner.cookie)).statusCode).toBe(200);
    const d = await del(`/api/projects/${projectId}/comments/${threadId}/replies/${first.id}`, commenter.cookie);
    expect(d.statusCode).toBe(200);
    expect(d.json().thread).toBeNull(); // last comment gone: thread removed
    expect((await get(`/api/projects/${projectId}/comments`, owner.cookie)).json().threads).toEqual([]);
  });

  it('validates input', async () => {
    expect((await post(`/api/projects/${projectId}/comments`, owner.cookie, { ...anchor, body: '   ' })).statusCode).toBe(400);
    expect((await post(`/api/projects/${projectId}/comments`, owner.cookie, { body: 'no anchors' })).statusCode).toBe(400);
    expect((await post(`/api/projects/${projectId}/comments/00000000-0000-0000-0000-000000000000/replies`, owner.cookie, { body: 'hi' })).statusCode).toBe(404);
  });
});

describe('the permissions table, enforced by the server', () => {
  const table = [
    ['owner', true, true, true, true, true],
    ['writer', true, true, true, true, false],
    ['commenter', true, true, false, false, false],
    ['reader', true, false, false, false, false],
  ] as const;

  for (const [role, canRead, canComment, canEdit, canDuplicate, canManage] of table) {
    it(`${role}: read ${canRead}, comment ${canComment}, edit ${canEdit}, duplicate ${canDuplicate}, manage ${canManage}`, async () => {
      const cookie = { owner, writer, commenter, reader }[role].cookie;
      const ok = (code: number, allowed: boolean) => expect(allowed ? code < 300 : code === 403, `${role} got ${code}`).toBe(true);
      ok((await get(`/api/projects/${projectId}`, cookie)).statusCode, canRead);
      ok((await get(`/api/projects/${projectId}/comments`, cookie)).statusCode, canRead);
      ok((await get(`/api/projects/${projectId}/doc`, cookie)).statusCode, canRead);
      ok((await post(`/api/projects/${projectId}/comments`, cookie, { ...anchor, body: 'hello' })).statusCode, canComment);
      ok((await patch(`/api/projects/${projectId}`, cookie, { title: 'Notes' })).statusCode, canEdit);
      ok((await post(`/api/projects/${projectId}/duplicate`, cookie)).statusCode, canDuplicate);
      ok((await get(`/api/projects/${projectId}/invites`, cookie)).statusCode, canManage);
      ok((await post(`/api/projects/${projectId}/archive`, cookie)).statusCode, canManage);
      if (canManage) await post(`/api/projects/${projectId}/unarchive`, cookie);
    });
  }

  it('non-members get 404 everywhere', async () => {
    expect((await get(`/api/projects/${projectId}/comments`, stranger.cookie)).statusCode).toBe(404);
    expect((await post(`/api/projects/${projectId}/comments`, stranger.cookie, { ...anchor, body: 'x' })).statusCode).toBe(404);
  });

  it("a Commenter's script edit is dropped by the collaboration server", async () => {
    const connect = (cookie: string) => {
      class CookieSocket extends WebSocket {
        constructor(url: string, protocols?: string | string[]) {
          super(url, protocols, { headers: { cookie } });
        }
      }
      const document = new Y.Doc();
      const websocketProvider = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}/collab`, WebSocketPolyfill: CookieSocket });
      const provider = new HocuspocusProvider({ websocketProvider, name: projectId, document, token: 'cookie' });
      const synced = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('not synced')), 5000);
        provider.on('synced', () => {
          clearTimeout(t);
          resolve();
        });
      });
      provider.attach();
      const text = () => document.getXmlFragment(SCRIPT_FIELD).toString();
      const insert = (s: string) => {
        const el = new Y.XmlElement('action');
        el.insert(0, [new Y.XmlText(s)]);
        document.getXmlFragment(SCRIPT_FIELD).push([el]);
      };
      return { synced, text, insert, destroy: () => { provider.destroy(); websocketProvider.destroy(); } };
    };
    const w = connect(writer.cookie);
    await w.synced;
    const c = connect(commenter.cookie);
    await c.synced;
    c.insert('a commenter trying to write');
    w.insert('the writer writing');
    const t0 = Date.now();
    while (!w.text().includes('the writer writing') && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 200));
    expect(w.text()).toContain('the writer writing');
    expect(w.text()).not.toContain('a commenter trying to write');
    const stored = await get(`/api/projects/${projectId}/doc`, owner.cookie);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(stored.rawPayload));
    expect(ydoc.getXmlFragment(SCRIPT_FIELD).toString()).not.toContain('a commenter trying to write');
    w.destroy();
    c.destroy();
  });
});
