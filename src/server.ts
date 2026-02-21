import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { AppConfig } from "./types.js";
import { RoomManager } from "./services/room-manager.js";
import { PanelEmitter } from "./services/panel-emitter.js";
import { ProfileManager } from "./services/profile-manager.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;

async function serveStatic(
  url: string,
  res: import("node:http").ServerResponse,
): Promise<boolean> {
  const filePath = url === "/" ? "/index.html" : url;
  const resolved = join(PUBLIC_DIR, filePath);

  // Directory traversal prevention
  if (!resolved.startsWith(PUBLIC_DIR)) return false;

  try {
    const data = await readFile(resolved);
    const ext = extname(resolved);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

export function startWebServer(config: AppConfig): void {
  const panelEmitter = new PanelEmitter();
  const profileManager = new ProfileManager();
  const roomManager = new RoomManager(config, panelEmitter, profileManager);

  const server = createServer(async (req, res) => {
    // Health endpoint
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Static files
    const served = await serveStatic(req.url ?? "/", res);
    if (served) return;

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
    const path = url.pathname;
    const room = url.searchParams.get("room");
    const user = url.searchParams.get("user");

    // Validate required params
    if (!room || !user) {
      ws.close(4000, "Missing room or user query parameter");
      return;
    }

    // Validate format
    if (!VALID_ID.test(room) || !VALID_ID.test(user)) {
      ws.close(4000, "Invalid room or user parameter format");
      return;
    }

    switch (path) {
      case "/ws/audio":
        roomManager.registerAudioSocket(room, user, ws);
        break;

      case "/ws/panels":
        roomManager.registerPanelSocket(room, user, ws);
        break;

      default:
        ws.close(4001, `Unknown path: ${path}`);
    }
  });

  wss.on("error", (err) =>
    console.error("[web] WebSocket server error:", err.message),
  );
  server.on("error", (err) =>
    console.error("[web] HTTP server error:", (err as Error).message),
  );

  server.listen(config.port, () => {
    console.log(`[web] Handshake server listening on port ${config.port}`);
    console.log(`[web] Health: http://localhost:${config.port}/health`);
    console.log(`[web] WebSocket: /ws/audio, /ws/panels`);
  });
}
