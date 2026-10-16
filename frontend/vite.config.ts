import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API_PROXY_TARGET lets Docker Compose point the dev proxy at the backend service.
// CHOKIDAR_USEPOLLING enables polling (required on macOS + Docker, where virtiofs
// does not forward inotify events).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8000';
const usePolling = Boolean(process.env.CHOKIDAR_USEPOLLING);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
