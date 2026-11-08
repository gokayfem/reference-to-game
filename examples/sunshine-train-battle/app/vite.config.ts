import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5174, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
} as any);
