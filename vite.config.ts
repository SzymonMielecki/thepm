import "./src/lib/server/load-dotenv";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { attachAudioWssToHttpServer } from "./src/lib/server/ws/ingest";
import { attachBridgeWssToHttpServer } from "./src/lib/server/ws/bridge-ws";

export default defineConfig({
  // Tailscale Funnel and other local proxies expect something listening; match
  // `tailscale funnel <port>` to this port (default 5173 with `npm run dev`).
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  plugins: [
    tailwindcss(),
    sveltekit(),
    {
      name: "pm-audio-ws",
      configureServer(s) {
        const h = s.httpServer;
        if (h) {
          const go = (server: import("http").Server) => {
            attachAudioWssToHttpServer(server);
            attachBridgeWssToHttpServer(server);
          };
          const s = h as import("http").Server;
          if (s.listening) go(s);
          else s.once("listening", () => go(s));
        }
      },
    },
  ],
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
    environment: "node",
  },
  optimizeDeps: {
    exclude: ["better-sqlite3", "@sveltejs/kit"],
  },
  ssr: {
    external: ["better-sqlite3", "ws", "chokidar", "@modelcontextprotocol/sdk"],
    noExternal: [],
  },
});
