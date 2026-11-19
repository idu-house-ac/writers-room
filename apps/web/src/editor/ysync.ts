// The Yjs sync plugin's state (document, fragment, binding), looked up by the plugin's registered
// name rather than by key object identity, so it works even if a bundler loaded the binding twice.
import type { EditorState } from '@tiptap/pm/state';
import type { ySyncPluginKey } from '@tiptap/y-tiptap';

type SyncState = NonNullable<ReturnType<typeof ySyncPluginKey.getState>>;

export function ySyncState(state: EditorState): SyncState | undefined {
  const plugin = state.plugins.find((p) => (p as unknown as { key: string }).key === 'y-sync$');
  return plugin?.getState(state) as SyncState | undefined;
}
