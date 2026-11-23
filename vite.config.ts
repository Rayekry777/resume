import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // Custom excludes replace plugin-react's defaults. Keep dependencies excluded too:
  // instrumenting the optimized PDF renderer imports browser Refresh inside its Worker.
  plugins: [react({ exclude: [/node_modules/, /src[\\/]pdf[\\/]/] }), VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: ['icon.svg', 'icon-maskable.svg', 'apple-touch-icon.png', 'fonts/OFL.txt'],
    manifest: {
      name: '简历', short_name: '简历',
      description: '简历编辑器',
      lang: 'zh-CN', start_url: './', scope: './', display: 'standalone',
      theme_color: '#5064ee', background_color: '#f7f8fc',
      icons: [{src:'icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'}, {src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}],
    },
    workbox: {
      globPatterns: ['**/*.{js,mjs,css,html,svg,png,webp,ttf,woff,txt,wasm}'],
      maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      navigateFallback: 'index.html',
      clientsClaim: true,
      skipWaiting: false,
    },
    devOptions: { enabled: false },
  })],
  // The renderer is reached through a Worker. Prebundle it explicitly so its
  // dependency version also changes when repairing old development transforms.
  optimizeDeps: { include: ['@react-pdf/renderer'] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  // Exercise the same resource policy as static hosting during release checks.
  preview: { port: 4173, strictPort: true, headers: {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'",
  } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 60000, fileParallelism: false },
} as Parameters<typeof defineConfig>[0]);
