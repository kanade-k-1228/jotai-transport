import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Rust transport server runs on the Raspberry Pi. For local dev it defaults to
// localhost; point SERVER_HOST at the Pi's address to drive real LEDs from your browser.
const SERVER_HOST = process.env.SERVER_HOST ?? 'localhost';
const SERVER_PORT = process.env.PORT ?? 8137;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Relay `/ws` to the transport server (ws: true proxies WebSocket connections)
      '/ws': {
        target: `ws://${SERVER_HOST}:${SERVER_PORT}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
    },
  },
});
