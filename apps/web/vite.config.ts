import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks to Vite only; Vite forwards /api to the server,
// so cookies are same-origin and no CORS is needed.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Yjs and its ProseMirror binding must exist exactly once in the page: plugin keys and class
  // identity break if the dev optimizer bundles a second copy inside another dependency.
  optimizeDeps: {
    include: ['yjs', '@tiptap/y-tiptap', '@tiptap/extension-collaboration', '@tiptap/extension-collaboration-caret', '@hocuspocus/provider', 'y-indexeddb', '@tiptap/pm/state', '@tiptap/pm/view', '@tiptap/pm/model'],
  },
  resolve: { dedupe: ['yjs', '@tiptap/y-tiptap', '@tiptap/pm'] },
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/collab': { target: apiTarget, ws: true, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
