import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createProject, createTestApp, makeUser, type TestContext } from './helpers';
import { SCRIPT_FIELD } from '../src/docs';
import { applyScript, blockDiff, scriptJson } from '../src/snapshots';

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof makeUser>>;
let commenter: Awaited<ReturnType<typeof makeUser>>;
let projectId: string;
let port: number;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await makeUser(ctx, 'owner@example.com', 'Owner');
  commenter = await makeUser(ctx, 'commenter@example.com', 'Commenter');
  projectId = (await createProject(ctx, owner.cookie, 'History')).id;
  await ctx.db.query(`insert into project_members (project_id, user_id, role) values ($1, $2, 'commenter')`, [projectId, commenter.id]);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  port = (ctx.app.server.address() as { port: number }).port;
});
afterAll(() => ctx.close());

const get = (url: string, cookie: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: Record<string, unknown>) => ctx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const until = async (cond: () => boolean | Promise<boolean>, ms = 5000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
};

function connect(cookie: string) {
  class CookieSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  }
  const document = new Y.Doc();
  const stateless: string[] = [];
  const websocketProvider = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}/collab`, WebSocketPolyfill: CookieSocket });
  const provider = new HocuspocusProvider({ websocketProvider, name: projectId, document, token: 'cookie', onStateless: ({ payload }) => stateless.push(payload) });
  const synced = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('not synced')), 5000);
    provider.on('synced', () => {
      clearTimeout(t);
      resolve();
    });
  });
  provider.attach();
  const frag = () => document.getXmlFragment(SCRIPT_FIELD);
  const lines = () => frag().toArray().map((el) => (el as Y.XmlElement).toString().replace(/<[^>]+>/g, ''));
  const setLines = (texts: string[]) => {
    document.transact(() => {
      frag().delete(0, frag().length);
      frag().push(
        texts.map((t) => {
          const el = new Y.XmlElement('action');
          el.insert(0, [new Y.XmlText(t)]);
          return el;
        }),
      );
    });
  };
  return { provider, websocketProvider, document, stateless, synced, lines, setLines, frag, destroy: () => { provider.destroy(); websocketProvider.destroy(); } };
}

describe('applyScript', () => {
  it('changes only the blocks that differ', () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment(SCRIPT_FIELD);
    const mk = (t: string) => {
      const el = new Y.XmlElement('action');
      el.insert(0, [new Y.XmlText(t)]);
      return el;
    };
    frag.push([mk('one'), mk('two'), mk('three')]);
    const keep = frag.get(2);
    const target = { type: 'doc' as const, content: [{ type: 'action', content: [{ type: 'text', text: 'one' }] }, { type: 'action', content: [{ type: 'text', text: 'TWO changed', marks: [{ type: 'bold' }] }] }, { type: 'action', content: [{ type: 'text', text: 'three' }] }, { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. NEW - DAY' }] }] };
    let replaced = 0;
    ydoc.transact(() => {
      replaced = applyScript(ydoc, target).replaced;
    });
    expect(replaced).toBe(3); // delete "two", insert "TWO changed", insert heading
    expect(frag.get(2)).toBe(keep); // untouched block keeps its identity (and therefore its comment anchors)
    expect(scriptJson(ydoc).content).toEqual(target.content);
  });
  it('diffs block lists', () => {
    const d = blockDiff(['a', 'b', 'c'], ['a', 'x', 'c', 'd']);
    expect(d.keepOld).toEqual([true, false, true]);
    expect(d.keepNew).toEqual([true, false, true, false]);
  });
});

describe('version history', () => {
  let draftId: string;
  let threadOnRemovedText: string;
  let threadOnKeptText: string;

  it('takes an automatic snapshot while editing and when the last person leaves', async () => {
    const a = connect(owner.cookie);
    await a.synced;
    a.setLines(['INT. START - DAY', 'First version of the scene.']);
    await until(async () => (await get(`/api/projects/${projectId}/snapshots`, owner.cookie)).json().snapshots.length >= 1, 4000);
    const list = (await get(`/api/projects/${projectId}/snapshots`, owner.cookie)).json().snapshots;
    expect(list[0].kind).toBe('auto');
    expect(list[0].authors.map((u: { name: string }) => u.name)).toEqual(['Owner']);
    a.destroy();
    // leaving: another snapshot only if something changed since the last one (nothing did)
    await new Promise((r) => setTimeout(r, 500));
    expect((await get(`/api/projects/${projectId}/snapshots`, owner.cookie)).json().snapshots.length).toBe(list.length);
  });

  it('names a draft (Owners and Writers only) and serves its content', async () => {
    expect((await post(`/api/projects/${projectId}/snapshots`, commenter.cookie, { name: 'nope' })).statusCode).toBe(403);
    const res = await post(`/api/projects/${projectId}/snapshots`, owner.cookie, { name: 'Draft 1 – table read' });
    expect(res.statusCode).toBe(201);
    draftId = res.json().id;
    const detail = await get(`/api/projects/${projectId}/snapshots/${draftId}`, owner.cookie);
    expect(detail.json().snapshot.name).toBe('Draft 1 – table read');
    expect(detail.json().snapshot.kind).toBe('named');
    expect(detail.json().snapshot.content.content.map((b: { content: { text: string }[] }) => b.content[0]!.text)).toEqual(['INT. START - DAY', 'First version of the scene.']);
    expect((await get(`/api/projects/${projectId}/snapshots/${draftId}`, commenter.cookie)).statusCode).toBe(200);
  });

  it('restores with a second client connected: both get the text, the notice, and a pre-restore copy exists', async () => {
    const a = connect(owner.cookie);
    await a.synced;
    const b = connect(commenter.cookie);
    await b.synced;
    // rewrite the second line and add a third; keep the heading
    a.setLines(['INT. START - DAY', 'Second version, quite different.', 'A brand new third line.']);
    await until(() => b.lines().length === 3);
    // comments: one on the heading (kept by the restore), one on the new third line (removed by it)
    const anchor = (doc: Y.Doc, blockIndex: number, from: number, to: number) => {
      const text = (doc.getXmlFragment(SCRIPT_FIELD).get(blockIndex) as Y.XmlElement).get(0) as Y.XmlText;
      const enc = (i: number) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, i))).toString('base64');
      return { anchorStart: enc(from), anchorEnd: enc(to) };
    };
    const t1 = await post(`/api/projects/${projectId}/comments`, owner.cookie, { ...anchor(a.document, 0, 5, 10), quotedText: 'START', body: 'keep me' });
    const t2 = await post(`/api/projects/${projectId}/comments`, owner.cookie, { ...anchor(a.document, 2, 2, 7), quotedText: 'brand', body: 'I will be detached' });
    threadOnKeptText = t1.json().thread.id;
    threadOnRemovedText = t2.json().thread.id;
    // make the draft look an hour old
    await ctx.db.query(`update snapshots set created_at = now() - interval '1 hour' where id = $1`, [draftId]);

    expect((await post(`/api/projects/${projectId}/snapshots/${draftId}/restore`, commenter.cookie)).statusCode).toBe(403);
    const res = await post(`/api/projects/${projectId}/snapshots/${draftId}/restore`, owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().detached).toBe(1);

    await until(() => a.lines().join('|') === 'INT. START - DAY|First version of the scene.' && b.lines().join('|') === 'INT. START - DAY|First version of the scene.');
    await until(() => a.stateless.some((p) => p.includes('"restore"')) && b.stateless.some((p) => p.includes('"restore"')));
    const notice = JSON.parse(a.stateless.find((p) => p.includes('"restore"')) ?? '{}');
    expect(notice).toMatchObject({ type: 'restore', by: 'Owner', label: 'Draft 1 – table read' });

    const list = res.json().snapshots;
    expect(list[0].kind).toBe('pre_restore');
    const pre = await get(`/api/projects/${projectId}/snapshots/${list[0].id}`, owner.cookie);
    expect(pre.json().snapshot.content.content.map((b: { content: { text: string }[] }) => b.content[0]!.text)).toEqual(['INT. START - DAY', 'Second version, quite different.', 'A brand new third line.']);

    const threads = (await get(`/api/projects/${projectId}/comments`, owner.cookie)).json().threads;
    expect(threads.find((t: { id: string }) => t.id === threadOnRemovedText).status).toBe('detached');
    expect(threads.find((t: { id: string }) => t.id === threadOnKeptText).status).toBe('open');

    // stored state matches the live one
    const stored = await get(`/api/projects/${projectId}/doc`, owner.cookie);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(stored.rawPayload));
    expect(ydoc.getXmlFragment(SCRIPT_FIELD).toString()).toBe(a.frag().toString());
    a.destroy();
    b.destroy();
  });

  it('restores when nobody is connected, too', async () => {
    const list = (await get(`/api/projects/${projectId}/snapshots`, owner.cookie)).json().snapshots;
    const pre = list.find((s: { kind: string }) => s.kind === 'pre_restore');
    const res = await post(`/api/projects/${projectId}/snapshots/${pre.id}/restore`, owner.cookie);
    expect(res.statusCode).toBe(200);
    const stored = await get(`/api/projects/${projectId}/doc`, owner.cookie);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(stored.rawPayload));
    expect(ydoc.getXmlFragment(SCRIPT_FIELD).toString()).toContain('A brand new third line.');
  });
});
