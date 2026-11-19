// The collaboration server: Hocuspocus over WebSocket, mounted on the API's own port at /collab
// (see app.ts) so the whole app is one process on one port. Before it syncs anything it asks the
// same database the API uses whether the connecting session may read or edit the project;
// Commenters and Readers get a read-only connection. Documents load from and store to project_docs.
import { Hocuspocus, type Extension } from '@hocuspocus/server';
import { Signer } from '@fastify/cookie';
import * as Y from 'yjs';
import { can, type FormatProfileId, type Role, type UserSummary } from '@writers-room/shared';
import { SESSION_COOKIE, loadSession } from './auth/session';
import type { Config } from './config';
import type { Db } from './db';
import { loadDoc, writeDoc } from './docs';
import { getRole } from './permissions';
import { takeSnapshot } from './snapshots';

export interface CollabContext {
  user: UserSummary;
  role: Role;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export interface CollabOptions {
  /** Store debounce in ms (shorter in tests). */
  debounce?: number;
  maxDebounce?: number;
  quiet?: boolean;
  /** Automatic snapshot at least this often while a document is being edited (default 10 minutes). */
  snapshotIntervalMs?: number;
  /** How often to check for documents due a snapshot (default 1 minute). */
  snapshotCheckMs?: number;
}

/** Editing activity per loaded document, for automatic snapshots. */
export interface Activity {
  authors: Set<string>;
  dirtySince: number | null;
  lastSnapshotAt: number;
}

export type CollabServer = Hocuspocus<CollabContext> & { stopSnapshots(): void; activity: Map<string, Activity> };

export function createCollabServer(deps: { config: Config; db: Db }, opts: CollabOptions = {}): CollabServer {
  const signer = new Signer(deps.config.SESSION_SECRET);
  const profiles = new Map<string, FormatProfileId>();
  const activity = new Map<string, Activity>();
  const interval = opts.snapshotIntervalMs ?? 10 * 60 * 1000;

  const activityOf = (name: string): Activity => {
    let a = activity.get(name);
    if (!a) {
      a = { authors: new Set(), dirtySince: null, lastSnapshotAt: Date.now() };
      activity.set(name, a);
    }
    return a;
  };

  const snapshotIfDue = async (name: string, document: Y.Doc, force: boolean) => {
    const a = activityOf(name);
    if (a.dirtySince === null) return;
    if (!force && Date.now() - a.lastSnapshotAt < interval) return;
    const authors = [...a.authors];
    a.dirtySince = null;
    a.authors.clear();
    a.lastSnapshotAt = Date.now();
    try {
      await takeSnapshot(deps.db, name, document, { kind: 'auto', authors, profile: profiles.get(name) ?? 'feature', skipIfUnchanged: true });
    } catch (err) {
      console.error('automatic snapshot failed', err);
    }
  };

  const persistence: Extension<CollabContext> = {
    extensionName: 'postgres-docs',
    async onLoadDocument({ document, documentName }) {
      const stored = await loadDoc(deps.db, documentName);
      if (stored) Y.applyUpdate(document, stored.state, 'db');
      return document;
    },
    async onStoreDocument({ document, documentName, lastContext }) {
      const profile = profiles.get(documentName) ?? 'feature';
      await writeDoc(deps.db, documentName, document, profile, lastContext?.user?.id ?? null);
    },
    async onChange({ documentName, context }) {
      const a = activityOf(documentName);
      a.dirtySince ??= Date.now();
      if (context?.user?.id) a.authors.add(context.user.id);
    },
    async onDisconnect({ documentName, document, clientsCount }) {
      // The last person left: keep a copy of what they ended with.
      if (clientsCount === 0) await snapshotIfDue(documentName, document, true);
    },
  };

  const hocuspocus = new Hocuspocus<CollabContext>({
    quiet: opts.quiet ?? deps.config.NODE_ENV === 'test',
    debounce: opts.debounce ?? 2000,
    maxDebounce: opts.maxDebounce ?? 10000,
    extensions: [persistence],
    async onAuthenticate({ requestHeaders, documentName, connectionConfig }) {
      const raw = cookieValue(requestHeaders.get('cookie'), SESSION_COOKIE);
      const unsigned = raw ? signer.unsign(raw) : null;
      if (!unsigned?.valid) throw new Error('Not signed in');
      const user = await loadSession(deps.db, unsigned.value);
      if (!user) throw new Error('Not signed in');
      const role = await getRole(deps.db, documentName, user.id);
      if (!role) throw new Error('Not a member of this project');
      if (!can(role, 'edit')) connectionConfig.readOnly = true;
      if (!profiles.has(documentName)) {
        const { rows } = await deps.db.query<{ format_profile: FormatProfileId }>('select format_profile from projects where id = $1', [documentName]);
        if (rows[0]) profiles.set(documentName, rows[0].format_profile);
      }
      const context: CollabContext = { user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url, colour: user.colour }, role };
      return context;
    },
  });

  const timer = setInterval(() => {
    for (const [name, document] of hocuspocus.documents) void snapshotIfDue(name, document, false);
  }, opts.snapshotCheckMs ?? 60 * 1000);
  timer.unref?.();

  return Object.assign(hocuspocus, {
    activity,
    stopSnapshots() {
      clearInterval(timer);
    },
  });
}

/** Who is connected to which document right now (for the dashboard's "is here" badge). */
export function presenceOf(collab: Hocuspocus<CollabContext>, projectIds: string[]): Record<string, UserSummary[]> {
  const out: Record<string, UserSummary[]> = {};
  for (const id of projectIds) {
    const doc = collab.documents.get(id);
    if (!doc) continue;
    const seen = new Map<string, UserSummary>();
    for (const state of doc.awareness.getStates().values()) {
      const u = (state as { user?: UserSummary & { color?: string } }).user;
      if (u?.id && !seen.has(u.id)) seen.set(u.id, { id: u.id, name: u.name, email: '', avatarUrl: null, colour: u.colour ?? u.color ?? '#888' });
    }
    if (seen.size) out[id] = [...seen.values()];
  }
  return out;
}
