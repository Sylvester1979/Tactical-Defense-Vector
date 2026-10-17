import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // The game, plus the standalone 3D rendering prototype
      input: {
        main: resolve(__dirname, 'index.html'),
        prototype: resolve(__dirname, 'prototype.html'),
      },
    },
  },
});
