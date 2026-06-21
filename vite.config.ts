import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { artlensDevApi } from './dev-api/plugin'

// HTTPS is mandatory for getUserMedia + deviceorientation. `basicSsl()` serves
// the dev server over a self-signed cert; `host: true` exposes it on the LAN so
// a phone on the same Wi-Fi can reach it at https://<your-mac-ip>:5173
// (accept the one-time certificate warning on the phone).
//
// `loadEnv(mode, cwd, '')` loads ALL env vars from .env (including non-VITE_
// keys) for the dev API plugin — those keys stay server-side and are NOT
// exposed to the client bundle (only VITE_-prefixed vars are).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), basicSsl(), artlensDevApi(env)],
    // transformers.js is large, ships its own ESM + workers + wasm, and its
    // first dynamic import otherwise triggers a disruptive Vite re-optimize +
    // full page reload mid-session. Excluding it keeps the in-browser depth
    // (keyless parallax) loading cleanly on demand.
    optimizeDeps: {
      exclude: ['@huggingface/transformers'],
    },
    server: {
      host: true,
      port: 5173,
    },
    preview: {
      host: true,
      port: 4173,
    },
  }
})
