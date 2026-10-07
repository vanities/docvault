// Temporary vite config for screenshotting against demo-data.
// Runs a second Vite dev server on 5174 that proxies /api to the demo backend
// on 3006. Leaves the user's main dev (5173 ↔ 3005) untouched.
import { defineConfig } from 'vite-plus';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  resolve: { alias: { '@': `${import.meta.dirname}/src` } },
  plugins: [tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3006' },
  },
});
