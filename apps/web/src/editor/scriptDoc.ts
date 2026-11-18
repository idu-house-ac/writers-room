// Loads a project's script as a Yjs document and autosaves it. In M1 the browser talks to the API
// directly: it sends only the changes since the last save, and the server merges them (so two tabs
// cannot overwrite each other). M2 replaces the transport with the collaboration server.
import * as Y from 'yjs';

export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'readonly';

export interface ScriptDoc {
  ydoc: Y.Doc;
  readonly status: SaveStatus;
  readonly pageCount: number;
  subscribe(listener: () => void): () => void;
  /** Save now (used before leaving the page). */
  flush(): Promise<void>;
  destroy(): void;
}

export const SCRIPT_FIELD = 'script';
const SAVE_DELAY_MS = 700;
/** While someone types continuously, save at least this often. */
const SAVE_MAX_INTERVAL_MS = 4000;
const RETRY_DELAY_MS = 5000;

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function openScriptDoc(projectId: string, canEdit: boolean): Promise<ScriptDoc> {
  const res = await fetch(`/api/projects/${projectId}/doc`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load the script (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ydoc = new Y.Doc({ gc: true });
  if (bytes.length) Y.applyUpdate(ydoc, bytes, 'remote');
  let serverVector: Uint8Array | null = res.headers.get('x-state-vector') ? b64ToBytes(res.headers.get('x-state-vector')!) : null;

  let status: SaveStatus = canEdit ? 'saved' : 'readonly';
  let pageCount = Number(res.headers.get('x-page-count') ?? 0);
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const setStatus = (s: SaveStatus) => {
    if (status !== s) {
      status = s;
      notify();
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let dirty = false;
  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = maxTimer = null;
  };

  async function save(): Promise<void> {
    if (!canEdit) return;
    if (saving) return saving;
    clearTimers();
    dirty = false;
    setStatus('saving');
    const update = Y.encodeStateAsUpdate(ydoc, serverVector ?? undefined);
    saving = (async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/doc`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/octet-stream' },
          body: update.slice().buffer as ArrayBuffer,
        });
        if (!r.ok) throw new Error(`save failed (${r.status})`);
        const data = (await r.json()) as { pageCount: number; stateVector: string };
        serverVector = b64ToBytes(data.stateVector);
        pageCount = data.pageCount;
        setStatus(dirty ? 'unsaved' : 'saved');
        if (dirty) schedule();
      } catch (err) {
        console.error(err);
        setStatus('error');
        dirty = true;
        timer = setTimeout(() => void save(), RETRY_DELAY_MS);
      } finally {
        saving = null;
      }
    })();
    return saving;
  }

  function schedule() {
    if (!canEdit) return;
    dirty = true;
    setStatus('unsaved');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DELAY_MS);
    if (!maxTimer) maxTimer = setTimeout(() => void save(), SAVE_MAX_INTERVAL_MS);
  }

  // Last-chance save when the tab closes or navigates away: a keepalive request outlives the page.
  const onPageHide = () => {
    if (!canEdit || (!dirty && !saving)) return;
    const update = Y.encodeStateAsUpdate(ydoc, serverVector ?? undefined);
    void fetch(`/api/projects/${projectId}/doc`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: update.slice().buffer as ArrayBuffer,
      keepalive: true,
    }).catch(() => undefined);
  };
  window.addEventListener('pagehide', onPageHide);

  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    schedule();
  };
  ydoc.on('update', onUpdate);

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (dirty || saving) e.preventDefault();
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  return {
    ydoc,
    get status() {
      return status;
    },
    get pageCount() {
      return pageCount;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async flush() {
      if (saving) await saving;
      if (dirty) await save();
    },
    destroy() {
      ydoc.off('update', onUpdate);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      clearTimers();
      if (dirty) void save();
    },
  };
}
