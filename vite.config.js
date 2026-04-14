import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const noCors = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.removeHeader('origin')
      proxyReq.removeHeader('referer')
    })
    proxy.on('error', (err) => console.error('[proxy]', err.message))
  }

  return {
    plugins: [react()],
    // Capacitor requires absolute asset paths (base: './') so the WebView can load them
    base: './',
    build: {
      // Output to dist/ — Capacitor copies this into the Android assets
      outDir: 'dist',
    },
    server: {
      port: 5173,
      proxy: {

        // ── Coinglass public REST ──────────────────────────────────────────
        '/api/coinglass-open': {
          target: 'https://open-api.coinglass.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/coinglass-open/, ''),
          configure: noCors,
        },

        // ── Coinglass futures REST ─────────────────────────────────────────
        '/api/coinglass-fapi': {
          target: 'https://fapi.coinglass.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/coinglass-fapi/, ''),
          configure: noCors,
        },

        // ── CoinMetrics Community API (free on-chain data, no key needed) ─
        '/api/coinmetrics': {
          target: 'https://community-api.coinmetrics.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/coinmetrics/, ''),
          configure: noCors,
        },

        // ── Dune Analytics (on-chain: MVRV, SOPR, exchange flows) ────────
        '/api/dune': {
          target: 'https://api.dune.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/dune/, ''),
          headers: { 'x-dune-api-key': env.VITE_DUNE_API_KEY },
          configure: noCors,
        },

        // ── SoSoValue — US BTC spot ETF daily flows (no auth required) ──────
        '/api/sosovalue': {
          target: 'https://sosovalue.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/sosovalue/, ''),
          configure: noCors,
        },

        // ── Tiingo equity prices / OHLCV (auth injected server-side) ─────────
        '/api/tiingo': {
          target: 'https://api.tiingo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/tiingo/, ''),
          headers: { 'Authorization': 'Token ' + env.VITE_TIINGO_TOKEN },
          configure: noCors,
        },

        // ── Farside Investors — Bitcoin ETF daily net flows (HTML table, no auth) ──
        // NOTE: noCors strips Referer which causes 403. Use custom configure that keeps Referer.
        '/api/farside': {
          target: 'https://farside.co.uk',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/farside/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer':    'https://farside.co.uk/',
            'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          configure: (proxy) => {
            // Only remove origin (not referer) — Farside needs a valid referer to allow access
            proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('origin'); })
            proxy.on('error', (err) => console.error('[proxy farside]', err.message))
          },
        },

        // ── Yahoo Finance (free public OHLCV — BTC=F CME futures, IBIT) ──
        '/api/yahoo': {
          target: 'https://query1.finance.yahoo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
          headers: { 'User-Agent': 'Mozilla/5.0' },
          configure: noCors,
        },

        // ── Anthropic Claude (server-side auth, key never hits browser) ───
        '/api/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
          headers: {
            'x-api-key': env.VITE_ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          configure: noCors,
        },

      },
    },
  }
})
