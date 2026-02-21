# Prompt 13 — Web Mode Orchestrator (server.ts, web.ts, room-manager.ts)

**Phase:** 4 (orchestration)
**Depends on:** all Phase 2 services, Phase 3 agent/tools
**Blocks:** 15-frontend (needs server routes to connect to)

## Task

Create the web mode entry point, HTTP/WebSocket server, and room manager. These three files wire everything together for the web deployment.

---

## File 1: src/web.ts

Minimal entry point for web mode.

```ts
import { loadConfig } from "./config.js";
import { startWebServer } from "./server.js";

const config = loadConfig();
const port = parseInt(process.env.PORT ?? "3000", 10);
startWebServer(config, port);
```

That's the entire file — 4 lines.

---

## File 2: src/server.ts

HTTP server with static file serving and WebSocket routing.

### Static file serving

```ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
```

- `__dirname` via `fileURLToPath(new URL(".", import.meta.url))`
- `PUBLIC_DIR = join(__dirname, "..", "public")`
- MIME type map:
  ```ts
  { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml" }
  ```

**`serveStatic(url: string, res: ServerResponse): Promise<boolean>`**
1. Map "/" to "/index.html"
2. Resolve path: `join(PUBLIC_DIR, url)`
3. **Directory traversal prevention**: `if (!resolved.startsWith(PUBLIC_DIR)) return false`
4. Try to read file with `readFile(resolved)`
5. Set Content-Type from MIME map (fallback: "application/octet-stream")
6. Write 200 response with file data
7. Return true (served) or false (not found)

### `startWebServer(config: AppConfig, port: number): void`

**Create HTTP server:**
```ts
const server = createServer(async (req, res) => {
  // Health endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      rooms: roomManager.getRoomCount(),
      signalRooms: signaling.getRoomCount(),
    }));
    return;
  }

  // Try static file
  const served = await serveStatic(req.url ?? "/", res);
  if (served) return;

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});
```

**Create WebSocketServer on same HTTP server:**
```ts
const wss = new WebSocketServer({ server });
```

**Input validation:**
```ts
const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;
```

**WebSocket connection handler:**
```ts
wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;
  const room = url.searchParams.get("room");
  const user = url.searchParams.get("user");
  const name = url.searchParams.get("name");

  if (!room || !user) {
    ws.close(4000, "Missing room or user query parameter");
    return;
  }

  if (!VALID_ID.test(room) || !VALID_ID.test(user)) {
    ws.close(4000, "Invalid room or user parameter format");
    return;
  }

  // Sanitize display name
  const sanitizedName = (name ?? user).slice(0, 100).replace(/[<>"'&]/g, "");

  switch (path) {
    case "/ws/audio":
      roomManager.handleAudioConnection(ws, room, user, sanitizedName);
      break;
    case "/ws/panels":
      roomManager.handlePanelConnection(ws, room, user);
      break;
    case "/ws/signal":
      signaling.handleConnection(ws, room, user);
      break;
    default:
      ws.close(4001, `Unknown path: ${path}`);
  }
});
```

**Error handlers and listen:**
```ts
wss.on("error", (err) => console.error("[web] WebSocket server error:", err.message));
server.on("error", (err) => console.error("[web] HTTP server error:", err.message));
server.listen(port, () => {
  console.log(`[web] Handshake web server listening on port ${port}`);
  console.log(`[web] Health check: http://localhost:${port}/health`);
  console.log(`[web] WebSocket paths: /ws/audio, /ws/panels, /ws/signal`);
});
```

---

## File 3: src/services/room-manager.ts

The core web mode orchestrator. Manages rooms, user slots, and wires the full pipeline.

### Class: RoomManager

**Constructor:** `(config: AppConfig)`

**Private state:**
```ts
private rooms = new Map<string, Room>();
private panelEmitter = new PanelEmitter();
private config: AppConfig;
```

**Constants:**
```ts
const MAX_USERS_PER_ROOM = 2;
const MAX_ROOMS = 50;
```

**Types:**
```ts
interface UserSlot {
  userId: string;
  userName: string;
  audio: AudioService;
  transcription: TranscriptionService;
  session: SessionService;
  agent: AgentService;
  peer: InProcessPeer | null;
  negotiation: NegotiationService | null;
  panelCleanup: (() => void) | null;
  transcriptCounter: number;
}

interface Room {
  code: string;
  slots: Map<string, UserSlot>;
  paired: boolean;
}
```

### Public methods

**`handleAudioConnection(ws, roomCode, userId, userName): void`**
1. `getOrCreateRoom(roomCode)` — close ws with 4003 if null
2. `getOrCreateSlot(room, userId, userName)` — close ws with 4004 if null
3. Listen for binary messages → `slot.audio.feedRawAudio(Buffer.from(raw))`
4. On close → `cleanupSlot(room, userId)`
5. If room has 2 users and not paired → `pairUsers(room)`

**`handlePanelConnection(ws, roomCode, userId): void`**
1. `panelEmitter.addConnection(userId, ws)`
2. Send room status if room exists

**`getRoomCount(): number`** — `rooms.size`
**`getRoomInfo(roomCode): { userCount, paired } | null`**

### Private methods

**`getOrCreateRoom(roomCode): Room | null`**
- Return existing or create new (if under MAX_ROOMS)

**`getOrCreateSlot(room, userId, userName): UserSlot | null`**
- Return existing or create new (if under MAX_USERS_PER_ROOM)
- Creates: AudioService, TranscriptionService (with ElevenLabs config), SessionService, AgentService (with LLM provider)
- Calls `session.initConversation(...)` with userId, userName, stripe config
- Wires: `audio.on("audio:chunk", chunk => transcription.feedAudio(chunk))`
- Starts: `audio.startCapture(16000)` and `transcription.start()` (catch errors → panel)
- Peer and negotiation are null until pairing
- Sends "joined" status to panel

**`cleanupSlot(room, userId): void`**
- Stop all services: audio, agent, transcription, session
- Destroy peer, call panelCleanup
- Remove from room, delete room if empty

**`pairUsers(room): void`** — This is the critical wiring method:
1. Set `room.paired = true`
2. Get both slots from the map
3. Create InProcessPeer pair: `InProcessPeer.createPair()` → assign to slots
4. Create NegotiationService for each: `new NegotiationService(peer)`
5. Start discovery on both peers
6. Set peer identity on each session:
   - slotA.session.setPeer({ userId: slotB.userId, name: slotB.userName, stripeAccountId: config.stripe.accountId })
   - slotB.session.setPeer({ userId: slotA.userId, name: slotA.userName, stripeAccountId: config.stripe.accountId })
7. Set speaker mapping (each user is their own speaker):
   - `slotA.session.setSpeakerMapping({ speaker_0: slotA.userId, [slotA.userId]: slotA.userId })`
   - Same for slotB
8. Wire transcription pipeline for both directions: `wireTranscriptionPipeline(slotA, slotB)` and `wireTranscriptionPipeline(slotB, slotA)`
9. Wire negotiation → agent for both
10. Wire panel emitter for both (store cleanup fn)
11. Start agents for both
12. Notify both users of pairing

**`wireTranscriptionPipeline(source, other): void`**
- Listen to `source.transcription.on("transcript:final", ...)`:
  1. Create TranscriptEntry with unique id, source.userId as speaker, isFinal: true
  2. Send final to BOTH panels:
     - source user: `{ panel: "transcript", type: "entry", data: { ..., source: "local" } }`
     - other user: `{ panel: "transcript", type: "entry", data: { ..., source: "peer" } }`
  3. If session is "active":
     - `source.session.addLocalTranscript(entry)`
     - `other.session.addPeerTranscript({ ...entry, source: "peer" })`
     - `source.agent.pushTranscript(entry)`
     - `other.agent.pushTranscript({ ...entry, source: "peer" })`
     - If peer exists: `source.peer.send({ type: "transcript", entry })`
- Listen to `source.transcription.on("transcript:partial", ...)`:
  - Send partial to BOTH panels: `{ panel: "transcript", type: "partial", data: { text, speaker: source.userId } }`

**`wireNegotiationToAgent(slot): void`**
- `negotiation.on("proposal:received", ...)` → `agent.pushNegotiationEvent({ type: "proposal_received", negotiation })`
- `negotiation.on("confirmed", ...)` → `agent.pushNegotiationEvent({ type: "response_received", negotiation })`
- `negotiation.on("execution:update", ...)` → if done/failed, push event

**`startAgent(slot): void`**
1. Get session state, check peer and negotiation exist
2. Create per-user service instances: PaymentService, MonzoService, TTSService, MiroService, SolanaService, ChainRecorder, EscrowManager, InsightsEngine, NFTMinter
3. Configure Monzo token if available
4. Configure saved payment method if available
5. Call `buildTools(...)` with all services + myUserId + credentials
6. Call `buildSystemPrompt(...)` with user config
7. `slot.agent.start(systemPrompt, tools)` — catch errors → panel

---

### Imports

```ts
import type WebSocket from "ws";
import type { FinalTranscript } from "../interfaces.js";
import type { TranscriptEntry, AppConfig } from "../types.js";
import { AudioService } from "./audio.js";
import { TranscriptionService } from "./transcription.js";
import { SessionService } from "./session.js";
import { NegotiationService } from "./negotiation.js";
import { AgentService } from "./agent.js";
import { PaymentService } from "./payment.js";
import { MonzoService } from "./monzo.js";
import { TTSService } from "./tts.js";
import { MiroService } from "./miro.js";
import { SolanaService } from "./solana.js";
import { ChainRecorder } from "./chain-recorder.js";
import { EscrowManager } from "./escrow.js";
import { NFTMinter } from "./nft-minter.js";
import { InsightsEngine } from "./insights.js";
import { InProcessPeer } from "./in-process-peer.js";
import { PanelEmitter } from "./panel-emitter.js";
import { createLLMProvider } from "../providers/index.js";
import { buildTools, buildSystemPrompt } from "../tools.js";
```

---

## Verification

- `curl http://localhost:3000/health` returns JSON with status "ok"
- Static files served from public/ with correct MIME types
- WebSocket connections route to correct handlers
- Room pairing creates full service stacks for both users
- Transcripts flow to both users' panels
- Agent starts with full tool suite after pairing
- Cleanup properly stops all services and removes from room
