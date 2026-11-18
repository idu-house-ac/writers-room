// Live document: a Yjs doc synced through the collaboration server over WebSocket, cached in
// IndexedDB so edits made offline survive a reload and merge when the connection returns.
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { CurrentUser } from '@writers-room/shared';

export type SyncStatus = 'connecting' | 'synced' | 'saving' | 'offline' | 'readonly' | 'denied';

export interface CollabDoc {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  readonly status: SyncStatus;
  readonly canEdit: boolean;
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

export const SCRIPT_FIELD = 'script';

export function collabUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/collab`;
}

export async function openCollabDoc(projectId: string, user: CurrentUser, canEdit: boolean): Promise<CollabDoc> {
  const ydoc = new Y.Doc({ gc: true });
  const cache = new IndexeddbPersistence(`writers-room-${projectId}`, ydoc);
  await cache.whenSynced.catch(() => undefined); // private mode: no cache, still works online

  const listeners = new Set<() => void>();
  let connection: 'connecting' | 'connected' | 'disconnected' = 'connecting';
  let synced = false;
  let unsynced = 0;
  let denied = false;
  const notify = () => listeners.forEach((l) => l());

  const provider = new HocuspocusProvider({
    url: collabUrl(),
    name: projectId,
    document: ydoc,
    // Authentication rides on the session cookie of the WebSocket upgrade; the token only tells the
    // provider to run the authentication step.
    token: 'session-cookie',
    onStatus: ({ status }) => {
      connection = status as typeof connection;
      if (connection !== 'connected') synced = false;
      notify();
    },
    onSynced: () => {
      synced = true;
      notify();
    },
    onUnsyncedChanges: ({ number }) => {
      unsynced = number;
      notify();
    },
    onAuthenticationFailed: () => {
      denied = true;
      notify();
    },
  });
  provider.setAwarenessField('user', { id: user.id, name: user.name, color: user.colour, colour: user.colour });

  const onOnline = () => notify();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOnline);

  return {
    ydoc,
    provider,
    canEdit,
    get status(): SyncStatus {
      if (denied) return 'denied';
      if (!canEdit) return connection === 'connected' ? 'readonly' : 'offline';
      if (connection !== 'connected' || !navigator.onLine) return connection === 'connecting' && navigator.onLine ? 'connecting' : 'offline';
      if (!synced) return 'connecting';
      return unsynced > 0 ? 'saving' : 'synced';
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      provider.destroy();
      void cache.destroy();
      ydoc.destroy();
    },
  };
}
