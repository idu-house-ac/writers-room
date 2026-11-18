import { Extension } from '@tiptap/core';
import type { FormatProfile } from '@writers-room/shared';
import { autocompletePlugin } from './autocomplete';
import { paginationPlugin, type ViewMode } from './pagination';
import { searchPlugin } from './search';

/** Page view, autocomplete and find/replace as ProseMirror plugins. Priority keeps autocomplete's keys ahead of the keymap. */
export const EditorPlugins = Extension.create<{ profile: FormatProfile; mode: ViewMode }>({
  name: 'editorPlugins',
  priority: 1000,
  addOptions() {
    return { profile: undefined as unknown as FormatProfile, mode: 'page' };
  },
  addProseMirrorPlugins() {
    return [autocompletePlugin(this.options.profile), paginationPlugin(this.options.profile, this.options.mode), searchPlugin()];
  },
});
