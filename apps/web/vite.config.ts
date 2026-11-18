import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks to Vite only; Vite forwards /api to the server,
// so cookies are same-origin and no CORS is needed.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';
const collabTarget = process.env.VITE_COLLAB_PROXY_TARGET ?? 'ws://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/collab': { target: collabTarget, ws: true, changeOrigin: false, rewrite: (path) => path.replace(/^\/collab/, '') },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
