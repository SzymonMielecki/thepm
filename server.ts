import "./src/lib/server/load-dotenv";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { isHubTokenDerivedFromPath } from "./src/lib/server/config.ts";
import { handler } from "./build/handler.js";
import { attachAudioWssToHttpServer } from "./src/lib/server/ws/ingest.ts";
import { attachBridgeWssToHttpServer } from "./src/lib/server/ws/bridge-ws.ts";

const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || "0.0.0.0";

function lanHttpOrigins(p: number): string[] {
  const nets = networkInterfaces();
  const out: string[] = [];
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      const v4 = n.family === "IPv4";
      if (v4 && !n.internal) {
        out.push(`http://${n.address}:${p}`);
      }
    }
  }
  return [...new Set(out)];
}

const server = createServer((req, res) => {
  handler(req, res, (err) => {
    if (err) {
      res.statusCode = 500;
      res.end("Internal Error");
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  });
});

attachAudioWssToHttpServer(server);
attachBridgeWssToHttpServer(server);

server.listen(port, host, () => {
  const loopback = `http://127.0.0.1:${port}`;
  const lans = lanHttpOrigins(port);
  console.log(`[hub] Dashboard:  ${loopback}/`);
  console.log(
    `[hub] Recorder PWA:  ${loopback}/recorder  (use HTTPS for mic; see README)`,
  );
  console.log(
    `[hub] WebSocket STT: ${loopback.replace("http", "ws")}/api/audio/stream  (same-origin upgrade as page)`,
  );
  if (lans.length) {
    for (const o of lans) {
      console.log(
        `[hub] On LAN (device):  ${o}/recorder  |  ${o.replace("http", "ws")}/api/audio/stream`,
      );
    }
  } else {
    console.log(
      "[hub] (no non-loopback IPv4; set HOST/PORT or use tailscale funnel — see README)",
    );
  }
  if (isHubTokenDerivedFromPath()) {
    console.log(
      "[hub] HUB_TOKEN: per-repo (derived from project path). Same value is prefilled in the web UI. For `thepm bridge --token`, copy it from the hub, or set HUB_TOKEN in a .env. HUB_TOKEN_AUTO=off = no token.",
    );
  }
  console.log(
    "[thepm] Data store: local `.thepm/hub.db` (THEPM_SQLITE_PATH overrides path).",
  );
  if (host === "0.0.0.0") {
    console.log(`[hub] Listening on ${host}:${port}`);
  } else {
    console.log(`[hub] Listening on http://${host}:${port}`);
  }
});
