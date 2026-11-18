// The collaboration server: Hocuspocus over WebSocket. Before it syncs anything it asks the same
// database the API uses whether the connecting session may read or edit the project; Commenters
// and Readers get a read-only connection. Documents load from and store to project_docs.
import { Server, type Hocuspocus, type Extension } from '@hocuspocus/server';
import { Signer } from '@fastify/cookie';
import * as Y from 'yjs';
import { can, type FormatProfileId, type Role, type UserSummary } from '@writers-room/shared';
import { SESSION_COOKIE, loadSession } from './auth/session';
import type { Config } from './config';
import type { Db } from './db';
import { loadDoc, writeDoc } from './docs';
import { getRole } from './permissions';

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
}

export function createCollabServer(deps: { config: Config; db: Db }, opts: CollabOptions = {}): Server<CollabContext> {
  const signer = new Signer(deps.config.SESSION_SECRET);
  const profiles = new Map<string, FormatProfileId>();

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
  };

  return new Server<CollabContext>({
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
