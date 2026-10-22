import { defineConfig } from 'vite';

// relative base: the build works at any path (GitHub Pages serves it from /<repo>/)
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
