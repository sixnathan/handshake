# W6C — Server + Entry Point

**Files to create:** `src/server.ts` and `src/web.ts`
**Depends on:** `src/services/room-manager.ts`, `src/services/panel-emitter.ts`, `src/services/profile-manager.ts`
**Depended on by:** Frontend (connects to WS endpoints)

---

## Purpose

HTTP server with static file serving, health endpoint, and WebSocket routing for audio and panel channels.

---

## File 1: src/web.ts (Entry Point)

```ts
import { loadConfig } from "./config.js";
import { startWebServer } from "./server.js";

const config = loadConfig();
startWebServer(config);
```

That's the entire file — 4 lines.

---

## File 2: src/server.ts

### Imports

```ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { AppConfig } from "./types.js";
import { RoomManager } from "./services/room-manager.js";
import { PanelEmitter } from "./services/panel-emitter.js";
import { ProfileManager } from "./services/profile-manager.js";
```

### Constants

```ts
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
```

### `serveStatic(url: string, res: ServerResponse): Promise<boolean>`

```ts
async function serveStatic(url: string, res: import("node:http").ServerResponse): Promise<boolean> {
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
```

### `startWebServer(config: AppConfig): void`

```ts
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

  wss.on("error", (err) => console.error("[web] WebSocket server error:", err.message));
  server.on("error", (err) => console.error("[web] HTTP server error:", (err as Error).message));

  server.listen(config.port, () => {
    console.log(`[web] Handshake server listening on port ${config.port}`);
    console.log(`[web] Health: http://localhost:${config.port}/health`);
    console.log(`[web] WebSocket: /ws/audio, /ws/panels`);
  });
}
```

---

## WebSocket Protocol Summary

### `/ws/audio?room=X&user=Y` — BIDIRECTIONAL BINARY
- **Client → Server**: Raw Int16 PCM, 16kHz mono (mic input)
- **Server → Client**: Raw Int16 PCM from other user (for playback via AudioRelayService)

### `/ws/panels?room=X&user=Y` — BIDIRECTIONAL JSON
- **Server → Client**: `PanelMessage` objects (transcript, agent, negotiation, document, execution, status, error)
- **Client → Server**: `ClientMessage` objects (set_profile, sign_document, set_trigger_keyword, join_room)

---

## Security Notes

- Directory traversal prevention: resolved path must start with PUBLIC_DIR
- Input validation: room and user IDs must match `^[a-zA-Z0-9_-]{1,64}$`
- No SQL/XSS on server side (data is JSON, not HTML)
- WebSocket connections validated on connect

---

## Verification

```bash
npx tsc --noEmit  # zero errors
npm run start:web  # should output "Handshake server listening on port 3000"
curl http://localhost:3000/health  # { "status": "ok" }
```

- Static files served from `public/` with correct MIME types
- Health endpoint returns JSON
- WebSocket connections route to room manager
- Invalid connections closed with error codes
- Directory traversal prevented
