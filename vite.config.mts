import { defineConfig } from 'vitest/config';

// base './' — сборка открывается из любой подпапки (GitHub Pages, itch.io).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
