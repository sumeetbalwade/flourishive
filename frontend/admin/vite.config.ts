import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Flourishive Admin: static SPA, deployed to cPanel as plain files.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
