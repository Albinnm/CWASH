import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { fs: { deny: ['.env', '.env.*', '**/.git/**', '**/*.{crt,pem}', '**/*.sqlite', '**/*.sqlite-*', '**/data/**'] } },
  build: { sourcemap: false },
});
