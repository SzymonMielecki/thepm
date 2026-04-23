import path from "node:path";
import "./src/lib/server/load-dotenv";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

/** PRD is written by the hub/agent; watching it triggers a full Vite reload and wipes client state. */
function prdPathsToIgnoreInDevWatch(): string[] {
  const out = new Set<string>(["**/PRD.md"]);
  try {
    const raw = (process.env.PRD_PATH || "PRD.md").trim();
    if (!raw) return [...out];
    const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    const rel = path.relative(process.cwd(), abs);
    if (rel && !rel.startsWith("..")) {
      out.add(rel.split(path.sep).join("/"));
    }
  } catch {
    /* ignore */
  }
  return [...out];
}

export default defineConfig({
  // Tailscale Funnel and other local proxies expect something listening; match
  // `tailscale funnel <port>` to this port (default 5173 with `npm run dev`).
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    watch: {
      ignored: prdPathsToIgnoreInDevWatch(),
    },
  },
  plugins: [
    tailwindcss(),
    sveltekit(),
    {
      name: "pm-audio-ws",
      configureServer(s) {
        const httpServer = s.httpServer;
        if (httpServer) {
          let attached = false;
          const go = async (server: import("http").Server) => {
            if (attached) return;
            attached = true;
            // Load from Vite SSR module graph so WS handlers and API routes share one registry singleton.
            const ingest = await s.ssrLoadModule("/src/lib/server/ws/ingest.ts");
            const bridge = await s.ssrLoadModule("/src/lib/server/ws/bridge-ws.ts");
            ingest.attachAudioWssToHttpServer(server);
            bridge.attachBridgeWssToHttpServer(server);
          };
          const server = httpServer as import("http").Server;
          if (server.listening) void go(server);
          else server.once("listening", () => void go(server));
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
    external: ["better-sqlite3", "ws", "chokidar"],
    noExternal: [],
  },
});
