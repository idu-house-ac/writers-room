import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import { Schema } from '@tiptap/pm/model';
import { createProject, createTestApp, makeUser, type TestContext } from './helpers';
import { docJsonToBlocks, pageCountOf, SCRIPT_FIELD } from '../src/docs';

// A minimal schema with the screenplay element names, enough to build Yjs documents for the tests.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: {},
    action: { group: 'block', content: 'text*' },
    sceneHeading: { group: 'block', content: 'text*' },
    character: { group: 'block', content: 'text*' },
    dialogue: { group: 'block', content: 'text*' },
  },
});

const el = (type: string, text: string) => ({ type, content: text ? [{ type: 'text', text }] : [] });
const docOf = (blocks: { type: string; text: string }[]) => prosemirrorJSONToYDoc(schema, { type: 'doc', content: blocks.map((b) => el(b.type, b.text)) }, SCRIPT_FIELD);

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof makeUser>>;
let reader: Awaited<ReturnType<typeof makeUser>>;
let projectId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await makeUser(ctx, 'owner@example.com', 'Owner');
  reader = await makeUser(ctx, 'reader@example.com', 'Reader');
  projectId = (await createProject(ctx, owner.cookie, 'Doc Test')).id;
  await ctx.db.query(`insert into project_members (project_id, user_id, role) values ($1, $2, 'reader')`, [projectId, reader.id]);
});
afterAll(() => ctx.close());

const putDoc = (cookie: string, update: Uint8Array) =>
  ctx.app.inject({ method: 'PUT', url: `/api/projects/${projectId}/doc`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: Buffer.from(update) });
const getDoc = (cookie: string) => ctx.app.inject({ method: 'GET', url: `/api/projects/${projectId}/doc`, headers: { cookie } });

describe('docJsonToBlocks', () => {
  it('flattens element nodes to blocks and skips unknown nodes', () => {
    const json = { content: [el('sceneHeading', 'INT. ROOM - DAY'), { type: 'mystery', content: [{ type: 'text', text: 'x' }] }, el('action', '')] };
    expect(docJsonToBlocks(json)).toEqual([
      { type: 'sceneHeading', text: 'INT. ROOM - DAY' },
      { type: 'action', text: '' },
    ]);
    expect(pageCountOf([], 'feature')).toBe(0);
    expect(pageCountOf([{ type: 'action', text: '' }], 'feature')).toBe(0);
    expect(pageCountOf([{ type: 'action', text: 'Hi.' }], 'feature')).toBe(1);
  });
});

describe('document storage', () => {
  it('starts empty', async () => {
    const res = await getDoc(owner.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(0);
    expect(res.headers['x-page-count']).toBe('0');
  });

  it('stores a document, computes the page count and updates the dashboard', async () => {
    const ydoc = docOf([
      { type: 'sceneHeading', text: 'INT. KITCHEN - DAY' },
      { type: 'action', text: 'Anna pours coffee.' },
      { type: 'character', text: 'ANNA' },
      { type: 'dialogue', text: 'Morning.' },
    ]);
    const res = await putDoc(owner.cookie, Y.encodeStateAsUpdate(ydoc));
    expect(res.statusCode).toBe(200);
    expect(res.json().pageCount).toBe(1);
    expect(res.json().stateVector).toBeTruthy();

    const back = await getDoc(owner.cookie);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, new Uint8Array(back.rawPayload));
    expect(loaded.getXmlFragment(SCRIPT_FIELD).toString()).toContain('Anna pours coffee.');
    expect(back.headers['x-page-count']).toBe('1');

    const list = await ctx.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: owner.cookie } });
    const project = list.json().projects.find((p: { id: string }) => p.id === projectId);
    expect(project.pageCount).toBe(1);
    expect(project.lastEditedBy.name).toBe('Owner');
  });

  it('merges a diff update instead of replacing the document', async () => {
    // Two clients start from the stored state and make different edits; both must survive.
    const stored = new Uint8Array((await getDoc(owner.cookie)).rawPayload);
    const a = new Y.Doc();
    Y.applyUpdate(a, stored);
    const b = new Y.Doc();
    Y.applyUpdate(b, stored);
    const svBefore = Y.encodeStateVector(a);
    const fragA = a.getXmlFragment(SCRIPT_FIELD);
    const fragB = b.getXmlFragment(SCRIPT_FIELD);
    const first = fragA.get(0) as Y.XmlElement; // scene heading
    (first.get(0) as Y.XmlText).insert(0, 'DAY 1 - ');
    const lastB = fragB.get(fragB.length - 1) as Y.XmlElement;
    (lastB.get(0) as Y.XmlText).insert(8, ' Coffee?');

    expect((await putDoc(owner.cookie, Y.encodeStateAsUpdate(a, svBefore))).statusCode).toBe(200);
    expect((await putDoc(owner.cookie, Y.encodeStateAsUpdate(b, svBefore))).statusCode).toBe(200);

    const merged = new Y.Doc();
    Y.applyUpdate(merged, new Uint8Array((await getDoc(owner.cookie)).rawPayload));
    const text = merged.getXmlFragment(SCRIPT_FIELD).toString();
    expect(text).toContain('DAY 1 - INT. KITCHEN - DAY');
    expect(text).toContain('Morning. Coffee?');
  });

  it('lets readers load but not save, and hides the doc from non-members', async () => {
    expect((await getDoc(reader.cookie)).statusCode).toBe(200);
    const ydoc = docOf([{ type: 'action', text: 'sneaky' }]);
    expect((await putDoc(reader.cookie, Y.encodeStateAsUpdate(ydoc))).statusCode).toBe(403);
    const stranger = await makeUser(ctx, 'stranger@example.com', 'Stranger');
    expect((await getDoc(stranger.cookie)).statusCode).toBe(404);
    expect((await putDoc(owner.cookie, new Uint8Array())).statusCode).toBe(400);
  });

  it('duplicating a project copies its document', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: `/api/projects/${projectId}/duplicate`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(201);
    const copy = await ctx.app.inject({ method: 'GET', url: `/api/projects/${res.json().project.id}/doc`, headers: { cookie: owner.cookie } });
    expect(copy.rawPayload.length).toBeGreaterThan(0);
    expect(res.json().project.pageCount).toBe(1);
  });
});
