# Prompt 15 — Web Frontend (public/index.html)

**Phase:** 5 (frontend)
**Depends on:** 13-web-orchestrator (server must exist to define WS routes)
**Blocks:** nothing

## Task

Create `public/index.html` — a single-page vanilla HTML/CSS/JS application. No framework, no build step. Everything in one file.

---

## File: public/index.html

### Page structure

Two screens (toggle via display: none/block):
1. **Pairing screen** (#pairing): enter name + room code, join button
2. **Session screen** (#session): 3-panel dashboard + status bar

---

### Pairing Screen

**Room code generation:**
```js
function generateRoomCode() {
  // 6-char alphanumeric, avoiding confusing chars: O/0, I/1, l
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
```

**User ID generation:**
```js
function generateUserId(name) {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${sanitized}-${suffix}`;
}
```

**UI elements:**
- Text input for name (required)
- Text input for room code (pre-filled with generated code, user can type a different one to join existing room)
- "Join" button
- Status text showing "Enter your name and room code"

**On join:**
1. Validate name is non-empty
2. Generate userId from name
3. Store roomCode, userId, userName
4. Switch to session screen
5. Connect WebSockets

---

### Session Screen

**Status bar** (top):
- Pulsing dot (orange while waiting, green when paired, red on error)
- Room code display
- User name display
- "Waiting for partner..." / "Connected to {peerName}" text

**Three-panel layout** (CSS Grid or Flexbox):
1. **Transcript panel** (left): live conversation
2. **Agent panel** (center): AI decisions and responses
3. **Execution panel** (right): negotiation lifecycle

Each panel has:
- Header with title
- Scrollable content area
- Auto-scroll behavior

---

### WebSocket Connections

**Audio WebSocket:**
```js
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const audioWs = new WebSocket(
  `${wsProtocol}//${location.host}/ws/audio?room=${roomCode}&user=${userId}&name=${encodeURIComponent(userName)}`
);
audioWs.binaryType = "arraybuffer";
```

**Panel WebSocket:**
```js
const panelWs = new WebSocket(
  `${wsProtocol}//${location.host}/ws/panels?room=${roomCode}&user=${userId}`
);
```

---

### Microphone Capture

```js
async function startMicrophone() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);

  // ScriptProcessorNode for raw PCM access
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    if (audioWs.readyState !== WebSocket.OPEN) return;

    const float32 = event.inputBuffer.getChannelData(0);
    const int16 = new Int16Array(float32.length);

    // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    audioWs.send(int16.buffer);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}
```

Key details:
- Sample rate: 16kHz (matches backend expectation)
- Buffer size: 4096 samples (~256ms latency)
- Float32 → Int16 conversion for efficient transmission
- Send as ArrayBuffer (binary) over audio WebSocket

---

### Panel Message Handler

```js
panelWs.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.panel) {
    case "transcript":
      handleTranscript(msg);
      break;
    case "agent":
      handleAgent(msg);
      break;
    case "execution":
      handleExecution(msg);
      break;
    case "status":
      handleStatus(msg);
      break;
  }
};
```

**handleTranscript(msg):**
- If `msg.type === "partial"`:
  - Find or create a partial element for this speaker
  - Update its text (italic, dimmed)
- If `msg.type === "entry"`:
  - Remove any partial element for this speaker
  - Create a new entry div with:
    - Speaker name (colored: local=green, peer=blue)
    - Text content
    - Timestamp
  - Append to transcript panel
  - Auto-scroll

**handleAgent(msg):**
- If `msg.type === "response"`:
  - Create entry with AI icon + text
  - Style: light purple background
- If `msg.type === "tool_call"`:
  - Create entry with tool name (purple badge)
  - Show input as formatted JSON (collapsed by default or small)
  - Show result (if present)

**handleExecution(msg):**
- If `msg.type === "proposal_received"`:
  - Show proposal card: amount, description, type, from/to
  - Orange border (pending)
- If `msg.type === "confirmed"`:
  - Show confirmation: green border, check mark
  - Update existing proposal card if present
- If `msg.type === "execution_update"`:
  - Show step + status
  - Green for "done", red for "failed"

**handleStatus(msg):**
- If `msg.type === "paired"`:
  - Update status dot to green
  - Show "Connected to {peerName}"
  - Start microphone capture
- If `msg.type === "error"`:
  - Update status dot to red
  - Show error message
- If `msg.type === "joined"`:
  - Show "Joined room {roomCode}"

---

### Auto-scroll behavior

```js
function autoScroll(container) {
  // Only scroll if user is near the bottom (within 100px)
  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  if (isNearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}
```

---

### CSS Styling

Dark theme, terminal aesthetic:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  background: #0a0a0a;
  color: #e0e0e0;
  height: 100vh;
  overflow: hidden;
}

/* Pairing screen */
#pairing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
}

#pairing input {
  background: #1a1a1a;
  border: 1px solid #333;
  color: #e0e0e0;
  padding: 12px 16px;
  font-size: 18px;
  font-family: inherit;
  border-radius: 4px;
  width: 300px;
}

#pairing button {
  background: #2d9c3c;
  color: white;
  border: none;
  padding: 12px 32px;
  font-size: 16px;
  font-family: inherit;
  border-radius: 4px;
  cursor: pointer;
}

/* Session screen */
#session { display: none; height: 100vh; flex-direction: column; }

/* Status bar */
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #111;
  border-bottom: 1px solid #222;
  font-size: 14px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f5a623; /* orange = waiting */
}

.status-dot.connected { background: #2d9c3c; }
.status-dot.error { background: #e74c3c; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.status-dot.waiting { animation: pulse 1.5s infinite; }

/* Panel grid */
.panels {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  flex: 1;
  gap: 1px;
  background: #222;
  overflow: hidden;
}

.panel {
  background: #0a0a0a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  padding: 8px 12px;
  background: #111;
  border-bottom: 1px solid #222;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #666;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

/* Transcript entries */
.transcript-entry { margin-bottom: 8px; line-height: 1.4; }
.speaker-local { color: #2d9c3c; font-weight: bold; }
.speaker-peer { color: #3498db; font-weight: bold; }
.transcript-partial { color: #666; font-style: italic; }

/* Agent entries */
.agent-response { margin-bottom: 8px; padding: 6px 8px; background: #1a1a2e; border-radius: 4px; }
.agent-tool {
  margin-bottom: 8px; padding: 6px 8px;
  border-left: 3px solid #8e44ad;
  background: #1a1a1a;
}
.tool-name { color: #8e44ad; font-weight: bold; font-size: 12px; }
.tool-args { color: #888; font-size: 11px; white-space: pre-wrap; }

/* Execution entries */
.execution-entry { margin-bottom: 8px; padding: 8px; border-radius: 4px; }
.execution-proposal { border: 1px solid #f5a623; background: #1a1500; }
.execution-confirmed { border: 1px solid #2d9c3c; background: #0a1a0a; }
.execution-update { border: 1px solid #333; background: #111; }
.execution-failed { border: 1px solid #e74c3c; background: #1a0a0a; }

/* Mobile responsive */
@media (max-width: 768px) {
  .panels {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr 1fr;
  }
  .panel { max-height: 33vh; }
}
```

---

### XSS Prevention

All dynamic text content must be escaped before insertion:

```js
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
```

Use `escapeHtml()` on ALL user-generated content (speaker names, transcript text, tool args) before setting innerHTML. Or use `textContent` for plain text.

---

### Complete HTML skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Handshake</title>
  <style>/* ... all CSS above ... */</style>
</head>
<body>
  <div id="pairing">
    <h1 style="color: #2d9c3c; margin-bottom: 24px;">🤝 Handshake</h1>
    <input id="nameInput" type="text" placeholder="Your name" autofocus>
    <input id="roomInput" type="text" placeholder="Room code">
    <button id="joinBtn">Join</button>
    <p id="pairingStatus" style="color: #666; font-size: 14px; margin-top: 8px;"></p>
  </div>

  <div id="session">
    <div class="status-bar">
      <div class="status-dot waiting" id="statusDot"></div>
      <span id="roomDisplay"></span>
      <span id="statusText">Waiting for partner...</span>
    </div>
    <div class="panels">
      <div class="panel">
        <div class="panel-header">Transcript</div>
        <div class="panel-content" id="transcriptPanel"></div>
      </div>
      <div class="panel">
        <div class="panel-header">Agent</div>
        <div class="panel-content" id="agentPanel"></div>
      </div>
      <div class="panel">
        <div class="panel-header">Execution</div>
        <div class="panel-content" id="executionPanel"></div>
      </div>
    </div>
  </div>

  <script>/* ... all JS above ... */</script>
</body>
</html>
```

---

## Verification

- Page loads at `http://localhost:3000/`
- Room code auto-generates 6 chars (no confusing characters)
- Joining switches to session screen
- Audio captured at 16kHz, converted to Int16, sent as binary
- Panel messages route to correct panels
- Transcript shows local (green) and peer (blue) speakers
- Partials update in-place, finals replace partials
- Agent panel shows responses and tool calls
- Execution panel shows negotiation lifecycle
- Auto-scroll works without jarring jumps
- Mobile responsive (stacks vertically)
- No XSS vulnerabilities
