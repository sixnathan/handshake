import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig } from "../../src/config.js";
import { PanelEmitter } from "../../src/services/panel-emitter.js";
import { ProfileManager } from "../../src/services/profile-manager.js";
import { RoomManager } from "../../src/services/room-manager.js";
import type { AppConfig } from "../../src/types.js";

const TEST_PORT = 3999;

describe("Server Integration (real server)", () => {
  let server: ReturnType<typeof createServer>;
  let wss: InstanceType<typeof WebSocketServer>;
  let config: AppConfig;

  beforeAll(async () => {
    config = loadConfig();
    config = { ...config, port: TEST_PORT };

    const panelEmitter = new PanelEmitter();
    const profileManager = new ProfileManager();
    const roomManager = new RoomManager(config, panelEmitter, profileManager);

    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const PUBLIC_DIR = join(__dirname, "..", "..", "public");

    const MIME_TYPES: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };

    server = createServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      const filePath = req.url === "/" ? "/index.html" : (req.url ?? "/");
      const resolved = join(PUBLIC_DIR, filePath);
      if (!resolved.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const data = await readFile(resolved);
        const ext = extname(resolved);
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
        });
        res.end(data);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    });

    wss = new WebSocketServer({ server });
    wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", `http://localhost:${TEST_PORT}`);
      const path = url.pathname;
      const room = url.searchParams.get("room");
      const user = url.searchParams.get("user");

      if (!room || !user) {
        ws.close(4000, "Missing room or user query parameter");
        return;
      }
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(room) ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(user)
      ) {
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

    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  });

  afterAll(async () => {
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should respond to /health endpoint", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("should serve index.html at /", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Handshake");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("should return 404 for unknown paths", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("should accept WebSocket connection on /ws/panels", async () => {
    const ws = new WebSocket(
      `ws://localhost:${TEST_PORT}/ws/panels?room=test-room&user=test-user`,
    );

    const connected = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });

    expect(connected).toBe(true);
    ws.close();
  });

  it("should reject WebSocket without room/user params", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws/panels`);

    const closeCode = await new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => resolve(-1));
      setTimeout(() => resolve(-1), 5000);
    });

    expect(closeCode).toBe(4000);
  });

  it("should reject WebSocket on unknown path", async () => {
    const ws = new WebSocket(
      `ws://localhost:${TEST_PORT}/ws/unknown?room=test&user=test`,
    );

    const closeCode = await new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => resolve(-1));
      setTimeout(() => resolve(-1), 5000);
    });

    expect(closeCode).toBe(4001);
  });

  it("should accept WebSocket connection on /ws/audio", async () => {
    const ws = new WebSocket(
      `ws://localhost:${TEST_PORT}/ws/audio?room=test-room&user=test-user`,
    );

    const connected = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });

    expect(connected).toBe(true);
    ws.close();
  });
});
