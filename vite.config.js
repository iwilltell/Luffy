import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// relative base: the build works from any GitHub Pages sub-path or a plain folder
export default defineConfig({
  base: './',
  plugins: [react()],
});
