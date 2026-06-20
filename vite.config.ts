import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS is mandatory for getUserMedia + deviceorientation. `basicSsl()` serves
// the dev server over a self-signed cert; `host: true` exposes it on the LAN so
// a phone on the same Wi-Fi can reach it at https://<your-mac-ip>:5173
// (accept the one-time certificate warning on the phone).
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
