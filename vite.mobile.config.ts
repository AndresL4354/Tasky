import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// App del celular (PWA): se publica en GitHub Pages desde dist-mobile/.
export default defineConfig({
  root: 'mobile',
  base: './',
  plugins: [svelte({ configFile: resolve(__dirname, 'svelte.config.js') })],
  server: { port: 1430, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
});
