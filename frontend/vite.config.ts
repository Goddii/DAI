import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// process.env is populated by Vite from .env files before the config is
// evaluated; on Vercel the project env vars are present in the build process.
// (Minimal ambient declarations: tsconfig.node.json has no node/dom libs.)
declare const process: { env: Record<string, string | undefined> }
declare const URL: new (url: string) => { origin: string }

/**
 * Emits the production Content-Security-Policy into index.html at build
 * time. The frontend (Vercel) and API (Render) are separate origins, so
 * connect-src must allow the API origin. It is derived from VITE_API_URL —
 * the same variable the API client uses — and only the ORIGIN is allowed,
 * never a path. Build-only: the dev server keeps its existing behavior
 * (no CSP, Vite HMR and the react-refresh preamble untouched).
 */
function cspPlugin(): Plugin {
  return {
    name: 'dai-csp',
    apply: 'build',
    transformIndexHtml(html) {
      let connectSrc = "'self'"
      const apiUrl = process.env.VITE_API_URL
      if (apiUrl && /^https?:\/\//.test(apiUrl)) {
        try {
          const origin = new URL(apiUrl).origin
          if (origin && origin !== 'null') connectSrc += ` ${origin}`
        } catch {
          // Malformed value: fall back to 'self' rather than failing the build.
        }
      }
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src ${connectSrc}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Dai — Market Credit Ledger',
        short_name: 'Dai',
        description:
          'Who owes me money? Record credit and payments for your market customers, even offline.',
        theme_color: '#253B66',
        background_color: '#F3F5F9',
        display: 'standalone',
        start_url: '/',
        lang: 'en',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        // No runtime caching for /api/*: authenticated responses are never
        // stored in Cache Storage. It is origin-scoped (shared by every
        // account on this device), survives logout, and can serve stale
        // financial data. IndexedDB is the only offline data store; the
        // precached shell keeps the app usable offline.
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
