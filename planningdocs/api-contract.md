# API Contract — Frontend ↔ Backend

This document defines every communication boundary between the browser frontend (`public/index.html`) and the backend server (`server.ts` + `room-manager.ts`).

---

## 1. HTTP Endpoints

### GET /health

Health check for monitoring and deployment.

**Request:** No body, no query params.

**Response:** `200 OK`
```json
{
  "status": "ok",
  "rooms": 3,
  "signalRooms": 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ok"` | Always "ok" if server is up |
| `rooms` | `number` | Active audio/negotiation rooms |
| `signalRooms` | `number` | Active WebRTC signaling rooms |

---

### GET / (and all static files)

Serves files from `public/` directory.

| Path | Serves | Content-Type |
|------|--------|-------------|
| `/` | `public/index.html` | `text/html; charset=utf-8` |
| `/*.css` | CSS files | `text/css; charset=utf-8` |
| `/*.js` | JS files | `application/javascript; charset=utf-8` |
| `/*.json` | JSON files | `application/json; charset=utf-8` |
| `/*.png` | Images | `image/png` |
| `/*.svg` | SVG | `image/svg+xml` |
| `/*.ico` | Favicon | `image/x-icon` |

**404 response:**
```json
{ "error": "not found" }
```

---

## 2. WebSocket Connections

All WebSocket connections use query parameters for identification. The protocol is `ws://` (local) or `wss://` (deployed).

### Connection URL Pattern
```
{ws|wss}://{host}/{path}?room={roomCode}&user={userId}&name={userName}
```

### Query Parameter Validation

| Param | Required | Format | Validation |
|-------|----------|--------|------------|
| `room` | Yes | String | `/^[a-zA-Z0-9_-]{1,64}$/` |
| `user` | Yes | String | `/^[a-zA-Z0-9_-]{1,64}$/` |
| `name` | No | String | Stripped of `<>"'&`, max 100 chars. Defaults to `user` value. |

### Error Codes

| Code | Reason | When |
|------|--------|------|
| `4000` | `"Missing room or user query parameter"` | `room` or `user` not provided |
| `4000` | `"Invalid room or user parameter format"` | Fails regex validation |
| `4001` | `"Unknown path: {path}"` | WebSocket path not recognized |
| `4003` | `"Server at capacity"` | MAX_ROOMS (50) reached |
| `4004` | `"Room is full"` | MAX_USERS_PER_ROOM (2) reached |

---

## 3. WebSocket: Audio Channel

**Path:** `/ws/audio?room={roomCode}&user={userId}&name={userName}`

**Direction:** Client → Server (one-way binary stream)

### Client Sends

Raw PCM audio as binary `ArrayBuffer` frames.

| Property | Value |
|----------|-------|
| Format | 16-bit signed integer PCM |
| Sample rate | 16000 Hz |
| Channels | 1 (mono) |
| Endianness | Little-endian (native) |
| Frame size | 4096 samples = 8192 bytes (~256ms) |

**Frontend encoding:**
```
Float32 [-1.0, 1.0] → Int16 [-32768, 32767]
Conversion: sample < 0 ? sample * 0x8000 : sample * 0x7FFF
Send: int16Array.buffer (ArrayBuffer)
```

### Server Receives

Binary `Buffer` or `ArrayBuffer` → fed to `AudioService.feedRawAudio()`.

### Server Does NOT Send

No messages flow from server to client on this channel. It is strictly one-way.

### Lifecycle

1. Client opens connection after user clicks "Join"
2. Client starts sending audio after receiving `"paired"` status on panel channel
3. Connection stays open until user leaves or tab closes
4. Server cleans up user slot on close

---

## 4. WebSocket: Panel Channel

**Path:** `/ws/panels?room={roomCode}&user={userId}`

**Direction:** Server → Client (one-way JSON stream)

### Message Envelope

Every message from server follows this shape:

```typescript
{
  panel: "transcript" | "agent" | "execution" | "status";
  type: string;
  data: object;
}
```

---

### 4.1 Panel: `"status"`

Room and connection lifecycle events.

#### type: `"room_status"`
Sent immediately on panel connection.
```json
{
  "panel": "status",
  "type": "room_status",
  "data": {
    "roomCode": "ABC123",
    "userCount": 1,
    "paired": false
  }
}
```

#### type: `"joined"`
Sent when user's audio slot is created.
```json
{
  "panel": "status",
  "type": "joined",
  "data": {
    "roomCode": "ABC123",
    "userId": "alice-x7k2",
    "userName": "Alice"
  }
}
```

#### type: `"paired"`
Sent to both users when the second user joins and pairing completes.
```json
{
  "panel": "status",
  "type": "paired",
  "data": {
    "peerId": "bob-m3n9",
    "peerName": "Bob"
  }
}
```

**Frontend action:** Update status dot to green, show "Connected to {peerName}", start microphone capture.

#### type: `"error"`
Sent when a service fails to initialize.
```json
{
  "panel": "status",
  "type": "error",
  "data": {
    "service": "transcription",
    "message": "ElevenLabs WebSocket connection failed"
  }
}
```

| `data.service` values | Description |
|-----------------------|-------------|
| `"audio"` | AudioService.startCapture() failed |
| `"transcription"` | TranscriptionService.start() failed |
| `"agent"` | AgentService.start() failed |

#### type: `"status_changed"`
Session state machine transition.
```json
{
  "panel": "status",
  "type": "status_changed",
  "data": {
    "status": "active"
  }
}
```

| `data.status` values | Meaning |
|----------------------|---------|
| `"discovering"` | Initial state |
| `"calibrating"` | Peer connected, setting up |
| `"active"` | Conversation in progress |
| `"ended"` | Conversation ended |

---

### 4.2 Panel: `"transcript"`

Live conversation transcript updates. Sent to BOTH users in the room.

#### type: `"partial"`
In-progress speech (not yet finalized by VAD).
```json
{
  "panel": "transcript",
  "type": "partial",
  "data": {
    "text": "I think we should maybe",
    "speaker": "alice-x7k2"
  }
}
```

**Frontend action:** Find or create a partial placeholder for this speaker. Update its text. Style as italic/dimmed.

#### type: `"entry"`
Finalized transcript segment.
```json
{
  "panel": "transcript",
  "type": "entry",
  "data": {
    "id": "t_1",
    "speaker": "alice-x7k2",
    "text": "I think we should split the cost fifty-fifty.",
    "isFinal": true,
    "source": "local",
    "timestamp": 1708523456789
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique transcript entry ID (e.g., `"t_1"`) |
| `speaker` | `string` | userId of the speaker |
| `text` | `string` | Finalized transcript text |
| `isFinal` | `true` | Always true for entries |
| `source` | `"local" \| "peer"` | "local" = this user spoke it, "peer" = the other user spoke it |
| `timestamp` | `number` | Unix ms timestamp |

**Frontend action:** Remove any partial placeholder for this speaker. Create permanent entry. Color-code: `source === "local"` → green, `source === "peer"` → blue.

**Note:** The same utterance is sent to both users — the speaker receives it with `source: "local"`, the listener receives it with `source: "peer"`.

---

### 4.3 Panel: `"agent"`

AI agent decisions, responses, and tool invocations.

#### type: `"response"`
Agent's natural language response.
```json
{
  "panel": "agent",
  "type": "response",
  "data": {
    "text": "I detected an agreement to split £50. Let me propose the terms."
  }
}
```

**Frontend action:** Display with AI indicator. Light purple background.

#### type: `"tool_call"`
Agent invoked a tool.
```json
{
  "panel": "agent",
  "type": "tool_call",
  "data": {
    "name": "send_proposal",
    "input": {
      "amount": 2500,
      "currency": "gbp",
      "description": "Split dinner cost",
      "type": "payment"
    },
    "result": "Proposal sent: 8f3a2b1c-..."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.name` | `string` | Tool name (see tools list in `12-tools.md`) |
| `data.input` | `object` | Arguments passed to the tool |
| `data.result` | `string` | Return value from the tool handler |

**Frontend action:** Display tool name as purple badge. Show input as formatted JSON. Show result text.

---

### 4.4 Panel: `"execution"`

Negotiation lifecycle events.

#### type: `"proposal_received"`
A proposal was received (from peer or self).
```json
{
  "panel": "execution",
  "type": "proposal_received",
  "data": {
    "id": "8f3a2b1c-...",
    "status": "proposed",
    "proposer": "alice-x7k2",
    "responder": "bob-m3n9",
    "agreement": {
      "amount": 2500,
      "currency": "gbp",
      "description": "Split dinner cost",
      "type": "payment",
      "from": "alice-x7k2",
      "to": "bob-m3n9"
    },
    "counterRound": 0,
    "createdAt": 1708523456789,
    "updatedAt": 1708523456789,
    "executionSteps": []
  }
}
```

**Frontend action:** Show proposal card with orange border. Display amount (divide by 100 for human-readable), description, from → to.

#### type: `"confirmed"`
A proposal was accepted.
```json
{
  "panel": "execution",
  "type": "confirmed",
  "data": {
    "id": "8f3a2b1c-...",
    "status": "accepted",
    "agreement": { ... },
    "counterRound": 0
  }
}
```

**Frontend action:** Show confirmation with green border and check mark.

#### type: `"execution_update"`
A step in the execution pipeline completed or failed.
```json
{
  "panel": "execution",
  "type": "execution_update",
  "data": {
    "negotiation": { ... },
    "step": "payment_executed",
    "status": "done"
  }
}
```

| `data.status` | Meaning | Frontend style |
|----------------|---------|----------------|
| `"done"` | Step completed successfully | Green text/border |
| `"failed"` | Step failed | Red text/border |
| `"pending"` | Step in progress | Orange text/border |

Common `data.step` values:
- `"payment_initiated"` — Payment creation started
- `"payment_executed"` — Payment completed
- `"escrow_created"` — Escrow hold placed
- `"escrow_captured"` — Escrow released to recipient
- `"on_chain_recorded"` — Agreement hash stored on Solana
- `"nft_minted"` — NFTs minted for both parties

---

## 5. WebSocket: Signal Channel

**Path:** `/ws/signal?room={roomCode}&user={userId}`

**Direction:** Bidirectional (client ↔ server ↔ client)

Used for WebRTC signaling relay. The server does NOT interpret these messages — it simply forwards them to other users in the same room.

### Client Sends / Receives

```json
{
  "type": "offer" | "answer" | "ice-candidate",
  "from": "alice-x7k2",
  "sdp": "...",
  "candidate": { ... }
}
```

| Message type | Direction | Contains |
|-------------|-----------|----------|
| `offer` | Caller → Callee | `sdp` (SDP offer string) |
| `answer` | Callee → Caller | `sdp` (SDP answer string) |
| `ice-candidate` | Both ways | `candidate` (ICE candidate object) |

**Server behavior:**
- Validates `type` is one of the three allowed values
- Adds `from: userId` field
- Forwards to ALL other users in the same room
- Does NOT echo back to sender

**Note:** This channel is optional for the core demo. The InProcessPeer handles negotiation relay server-side. This channel exists for future WebRTC audio/video if needed.

---

## 6. Frontend → Backend Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│                     BROWSER                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  getUserMedia (16kHz)                                   │
│       │                                                 │
│       ▼                                                 │
│  AudioContext → ScriptProcessor                         │
│       │                                                 │
│       ▼ Float32 → Int16                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ /ws/audio │    │/ws/panels│    │/ws/signal│          │
│  │  binary → │    │ ← JSON   │    │ ↔ JSON   │          │
│  └─────┬─────┘    └─────┬─────┘    └──────────┘          │
│        │                │                                │
│        │                ▼                                │
│        │         Route by msg.panel:                     │
│        │         ├── "transcript" → Transcript Panel     │
│        │         ├── "agent"      → Agent Panel          │
│        │         ├── "execution"  → Execution Panel      │
│        │         └── "status"     → Status Bar           │
└────────┼────────────────────────────────────────────────┘
         │
─────────┼──── NETWORK ────────────────────────────────────
         │
┌────────┼────────────────────────────────────────────────┐
│        ▼           SERVER                               │
│  RoomManager                                            │
│  ├── AudioService.feedRawAudio(pcm)                     │
│  │       │                                              │
│  │       ▼ 250ms chunks                                 │
│  │  TranscriptionService.feedAudio()                    │
│  │       │                                              │
│  │       ├── transcript:partial → PanelEmitter → BOTH   │
│  │       └── transcript:final   → PanelEmitter → BOTH   │
│  │                              → SessionService        │
│  │                              → AgentService (2s batch)│
│  │                                     │                │
│  │                                     ▼                │
│  │                              LLM (Claude)            │
│  │                                     │                │
│  │                              ├── text → PanelEmitter │
│  │                              └── tool → Execute      │
│  │                                    │    → PanelEmitter│
│  │                                    ▼                 │
│  │                              NegotiationService      │
│  │                              PaymentService          │
│  │                              SolanaService           │
│  │                              etc.                    │
│  │                                    │                 │
│  │                                    ▼                 │
│  │                              PanelEmitter → /ws/panels│
│  └──────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────┘
```

---

## 7. Room Code & User ID Generation (Frontend)

### Room Code
- 6 characters
- Alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (excludes O/0, I/1, l to avoid confusion)
- Generated client-side, can be overridden by user typing an existing code

### User ID
- Format: `{sanitizedName}-{4charSuffix}`
- sanitizedName: lowercase, strip non-alphanumeric
- suffix: `Math.random().toString(36).slice(2, 6)`
- Example: `"alice-x7k2"`, `"bob-m3n9"`

---

## 8. Connection Sequence

```
1. User enters name + room code, clicks "Join"
2. Frontend generates userId
3. Frontend opens /ws/audio  (binary, client→server)
4. Frontend opens /ws/panels (JSON, server→client)
5. Frontend receives { panel: "status", type: "joined" }
6. Frontend waits...
7. Second user joins same room
8. Server pairs users (creates service stacks, wires pipeline)
9. Frontend receives { panel: "status", type: "paired", data: { peerName } }
10. Frontend starts microphone capture
11. Audio flows: mic → /ws/audio → server → ElevenLabs → transcripts
12. Transcripts flow: server → /ws/panels → both frontends
13. Agent decisions flow: server → /ws/panels → both frontends
14. Conversation continues until disconnect
15. On WS close: server cleans up slot, removes room if empty
```
