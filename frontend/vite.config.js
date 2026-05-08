import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Pre-cache all build assets + the listed public-dir assets
      includeAssets: ['favicon-32x32.png', 'favicon-16x16.png', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'ShopSync',
        short_name: 'ShopSync',
        description: 'Vehicle service tracker for shops and customers',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            // Maskable: safe-zone is the inner 80% — the black square fills the whole
            // canvas so it works as a maskable icon without extra padding
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache all built static assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't cache API calls — always go to network
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/vehicles\//],
      },
    }),
  ],
})
