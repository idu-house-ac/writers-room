import { Extension } from '@tiptap/core';
import { ELEMENT_TYPES, type ElementType, type FormatProfile } from '@writers-room/shared';
import { enterCommand, setElement, shiftTabCommand, skipClosingParen, tabCommand } from './commands';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    screenplay: {
      setElement: (type: ElementType) => ReturnType;
      screenplayEnter: () => ReturnType;
      screenplayTab: () => ReturnType;
    };
  }
}

/** Keyboard behaviour of the screenplay editor: Enter, Tab, Shift+Tab and Mod+1..8. */
export const ScreenplayKit = Extension.create<{ profile: FormatProfile }>({
  name: 'screenplayKit',
  addOptions() {
    return { profile: undefined as unknown as FormatProfile };
  },
  addCommands() {
    const profile = this.options.profile;
    return {
      setElement:
        (type) =>
        ({ state, dispatch }) =>
          setElement(type)(state, dispatch),
      screenplayEnter:
        () =>
        ({ state, dispatch }) =>
          enterCommand(profile)(state, dispatch),
      screenplayTab:
        () =>
        ({ state, dispatch }) =>
          tabCommand(profile)(state, dispatch),
    };
  },
  addKeyboardShortcuts() {
    const profile = this.options.profile;
    const shortcuts: Record<string, () => boolean> = {
      Enter: () => this.editor.commands.screenplayEnter(),
      Tab: () => this.editor.commands.screenplayTab(),
      'Shift-Tab': () => shiftTabCommand(profile)(this.editor.state, this.editor.view.dispatch),
      ')': () => skipClosingParen()(this.editor.state, this.editor.view.dispatch),
    };
    ELEMENT_TYPES.forEach((type, i) => {
      shortcuts[`Mod-${i + 1}`] = () => this.editor.commands.setElement(type);
    });
    return shortcuts;
  },
});
