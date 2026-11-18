import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createProject, createTestApp, makeUser, type TestContext } from './helpers';
import { presenceOf } from '../src/collab';
import { SCRIPT_FIELD } from '../src/docs';

let ctx: TestContext;
let port: number;
let owner: Awaited<ReturnType<typeof makeUser>>;
let reader: Awaited<ReturnType<typeof makeUser>>;
let stranger: Awaited<ReturnType<typeof makeUser>>;
let projectId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await makeUser(ctx, 'owner@example.com', 'Owner');
  reader = await makeUser(ctx, 'reader@example.com', 'Reader');
  stranger = await makeUser(ctx, 'stranger@example.com', 'Stranger');
  projectId = (await createProject(ctx, owner.cookie, 'Collab')).id;
  await ctx.db.query(`insert into project_members (project_id, user_id, role) values ($1, $2, 'reader')`, [projectId, reader.id]);
  // The WebSocket lives on the API's own port at /collab, so listen for real.
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  port = (ctx.app.server.address() as { port: number }).port;
});
afterAll(() => ctx.close());

/** A provider that connects like a browser would: the session cookie rides on the upgrade request. */
function connect(cookie: string | null) {
  class CookieSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: cookie ? { cookie } : {} });
    }
  }
  const document = new Y.Doc();
  const events: string[] = [];
  const websocketProvider = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}/collab`, WebSocketPolyfill: CookieSocket });
  websocketProvider.on('status', (e: { status: string }) => events.push(`status:${e.status}`));
  websocketProvider.on('close', (e: { event?: { code?: number; reason?: string } }) => events.push(`close:${e?.event?.code}:${e?.event?.reason}`));
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: projectId,
    document,
    token: 'cookie',
    onAuthenticationFailed: ({ reason }) => events.push(`auth-failed:${reason}`),
    onSynced: () => events.push('synced'),
  });
  const synced = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`not synced; events: ${events.join(',')}`)), 5000);
    provider.on('synced', () => {
      clearTimeout(t);
      resolve();
    });
    provider.on('authenticationFailed', () => {
      clearTimeout(t);
      reject(new Error(events.join(',')));
    });
  });
  provider.attach(); // a provider given an external socket does not attach itself
  const text = () => document.getXmlFragment(SCRIPT_FIELD).toString();
  const insertBlock = (s: string) => {
    const el = new Y.XmlElement('action');
    el.insert(0, [new Y.XmlText(s)]);
    document.getXmlFragment(SCRIPT_FIELD).push([el]);
  };
  return { provider, websocketProvider, document, events, synced, text, insertBlock, destroy: () => { provider.destroy(); websocketProvider.destroy(); } };
}

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('collaboration server', () => {
  it('rejects connections without a session or from non-members', async () => {
    const anon = connect(null);
    await expect(anon.synced).rejects.toThrow(/auth-failed/);
    anon.destroy();
    const outsider = connect(stranger.cookie);
    await expect(outsider.synced).rejects.toThrow(/auth-failed/);
    outsider.destroy();
  });

  it('syncs two writers and stores the result with a page count', async () => {
    const a = connect(owner.cookie);
    await a.synced;
    a.insertBlock('INT. FIRST - DAY');
    const b = connect(owner.cookie);
    await b.synced;
    await until(() => b.text().includes('INT. FIRST - DAY'));
    b.insertBlock('From the second window.');
    await until(() => a.text().includes('From the second window.'));
    expect(a.text()).toBe(b.text());
    await until(() => ctx.collab.getConnectionsCount() === 2);

    // stored after the debounce
    await until(() => false, 300).catch(() => undefined);
    const res = await ctx.app.inject({ method: 'GET', url: `/api/projects/${projectId}/doc`, headers: { cookie: owner.cookie } });
    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array(res.rawPayload));
    expect(stored.getXmlFragment(SCRIPT_FIELD).toString()).toBe(a.text());
    expect(res.headers['x-page-count']).toBe('1');
    const list = await ctx.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: owner.cookie } });
    expect(list.json().projects[0].lastEditedBy.name).toBe('Owner');
    a.destroy();
    b.destroy();
  });

  it('gives readers a read-only connection whose edits never reach anyone', async () => {
    const w = connect(owner.cookie);
    await w.synced;
    const r = connect(reader.cookie);
    await r.synced;
    expect(r.text()).toContain('INT. FIRST - DAY');
    r.insertBlock('sneaky edit');
    w.insertBlock('legit edit');
    await until(() => r.text().includes('legit edit'));
    await until(() => false, 200).catch(() => undefined);
    expect(w.text()).not.toContain('sneaky edit');
    const res = await ctx.app.inject({ method: 'GET', url: `/api/projects/${projectId}/doc`, headers: { cookie: owner.cookie } });
    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array(res.rawPayload));
    expect(stored.getXmlFragment(SCRIPT_FIELD).toString()).not.toContain('sneaky edit');
    w.destroy();
    r.destroy();
  });

  it('merges edits made while disconnected', async () => {
    const a = connect(owner.cookie);
    await a.synced;
    const b = connect(owner.cookie);
    await b.synced;
    b.websocketProvider.disconnect();
    b.insertBlock('written offline');
    a.insertBlock('written online meanwhile');
    await until(() => false, 150).catch(() => undefined);
    expect(a.text()).not.toContain('written offline');
    await b.websocketProvider.connect();
    await until(() => a.text().includes('written offline') && b.text().includes('written online meanwhile'));
    expect(a.text()).toBe(b.text());
    a.destroy();
    b.destroy();
  });

  it('reports presence for the dashboard', async () => {
    const a = connect(owner.cookie);
    await a.synced;
    a.provider.setAwarenessField('user', { id: owner.id, name: 'Owner', colour: owner.colour });
    await until(() => false, 150).catch(() => undefined);
    const p = presenceOf(ctx.collab, [projectId]);
    expect(p[projectId]?.map((u) => u.name)).toEqual(['Owner']);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/presence', headers: { cookie: owner.cookie } });
    expect(res.json().presence[projectId].map((u: { name: string }) => u.name)).toEqual(['Owner']);
    a.destroy();
  });
});
