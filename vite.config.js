import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { fs: { deny: ['.env', '.env.*', '**/.git/**', '**/*.{crt,pem,key,jks,p8,p12,mobileprovision}', '**/*.sqlite', '**/*.sqlite-*', '**/data/**'] } },
  build: { sourcemap: false },
});
