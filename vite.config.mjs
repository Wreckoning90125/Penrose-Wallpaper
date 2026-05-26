import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2024',
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: '0.0.0.0',
    strictPort: false,
  },
  preview: {
    host: '0.0.0.0',
    strictPort: false,
  },
});
