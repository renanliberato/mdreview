import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  build: {
    outDir: 'dist',
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
