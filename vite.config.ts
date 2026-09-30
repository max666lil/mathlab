import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves this project from /mathlab/. Local development stays at /.
  base: process.env.GITHUB_ACTIONS ? '/mathlab/' : '/',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'] },
} as any);
