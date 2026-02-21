# W7 — Frontend

**File to create:** `public/index.html`
**Depends on:** Server must define the WS protocol (W6C)
**Depended on by:** Nothing (end of chain)

---

## Purpose

Single-page vanilla HTML/CSS/JS application. No framework, no build step, everything in one file. Dark theme, room-based pairing, real-time audio streaming, transcript display, agent panel, negotiation lifecycle, document popup with signature flow.

---

## Page Structure

Two screens (toggle via `display: none/flex`):
1. **Setup screen** (`#setup`): profile configuration + room join
2. **Session screen** (`#session`): status bar + 4-panel dashboard + document overlay

---

## Setup Screen

### Profile Form

```html
<div id="setup">
  <h1>Handshake</h1>
  <form id="profileForm">
    <input id="displayName" placeholder="Your name" required />
    <input id="role" placeholder="Your role (e.g., landlord, plumber)" />
    <textarea id="customInstructions" placeholder="Instructions for your AI agent (optional)"></textarea>

    <h3>Agent Preferences</h3>
    <label>Max auto-approve: £<input id="maxApprove" type="number" value="50" min="0" step="1" /></label>
    <label>Currency: <select id="currency"><option value="gbp">GBP</option><option value="usd">USD</option><option value="eur">EUR</option></select></label>
    <label>Escrow:
      <select id="escrowPref">
        <option value="above_threshold">Above threshold</option>
        <option value="always">Always</option>
        <option value="never">Never</option>
      </select>
    </label>
    <label>Escrow threshold: £<input id="escrowThreshold" type="number" value="100" min="0" step="1" /></label>
    <label>Style:
      <select id="negStyle">
        <option value="balanced">Balanced</option>
        <option value="aggressive">Aggressive</option>
        <option value="conservative">Conservative</option>
      </select>
    </label>

    <h3>Payment (optional)</h3>
    <input id="stripeId" placeholder="Stripe Connect account ID (acct_...)" />
    <input id="monzoToken" placeholder="Monzo access token" type="password" />

    <h3>Room</h3>
    <input id="roomCode" placeholder="Room code" />
    <button type="submit">Join Room</button>
  </form>
  <p id="setupStatus"></p>
</div>
```

### Profile Persistence (localStorage)

```js
const PROFILE_KEY = "handshake_profile";

function loadProfile() {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    if (saved) {
      const profile = JSON.parse(saved);
      // Populate form fields from saved profile
      document.getElementById("displayName").value = profile.displayName ?? "";
      document.getElementById("role").value = profile.role ?? "";
      document.getElementById("customInstructions").value = profile.customInstructions ?? "";
      document.getElementById("maxApprove").value = String((profile.preferences?.maxAutoApproveAmount ?? 5000) / 100);
      document.getElementById("currency").value = profile.preferences?.preferredCurrency ?? "gbp";
      document.getElementById("escrowPref").value = profile.preferences?.escrowPreference ?? "above_threshold";
      document.getElementById("escrowThreshold").value = String((profile.preferences?.escrowThreshold ?? 10000) / 100);
      document.getElementById("negStyle").value = profile.preferences?.negotiationStyle ?? "balanced";
      document.getElementById("stripeId").value = profile.stripeAccountId ?? "";
      // Note: don't load monzoToken from storage for security
    }
  } catch { /* ignore parse errors */ }
}

function buildProfile() {
  const profile = {
    displayName: document.getElementById("displayName").value.trim(),
    role: document.getElementById("role").value.trim() || "participant",
    customInstructions: document.getElementById("customInstructions").value.trim(),
    preferences: {
      maxAutoApproveAmount: Math.round(Number(document.getElementById("maxApprove").value) * 100),
      preferredCurrency: document.getElementById("currency").value,
      escrowPreference: document.getElementById("escrowPref").value,
      escrowThreshold: Math.round(Number(document.getElementById("escrowThreshold").value) * 100),
      negotiationStyle: document.getElementById("negStyle").value,
    },
    stripeAccountId: document.getElementById("stripeId").value.trim() || undefined,
    monzoAccessToken: document.getElementById("monzoToken").value.trim() || undefined,
  };
  // Save to localStorage (without sensitive tokens)
  const toSave = { ...profile };
  delete toSave.monzoAccessToken;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(toSave));
  return profile;
}
```

### Room Code Generation

```js
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Pre-fill room code
document.getElementById("roomCode").value = generateRoomCode();
```

### User ID Generation

```js
function generateUserId(name) {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${sanitized}-${suffix}`;
}
```

### On Submit

```js
document.getElementById("profileForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const profile = buildProfile();
  if (!profile.displayName) {
    document.getElementById("setupStatus").textContent = "Name is required";
    return;
  }
  const roomCode = document.getElementById("roomCode").value.trim();
  if (!roomCode) {
    document.getElementById("setupStatus").textContent = "Room code is required";
    return;
  }
  const userId = generateUserId(profile.displayName);
  startSession(userId, roomCode, profile);
});
```

---

## Session Screen

### Layout

```html
<div id="session" style="display: none;">
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
      <div class="panel-header">Negotiation</div>
      <div class="panel-content" id="negotiationPanel"></div>
    </div>
    <div class="panel">
      <div class="panel-header">Execution</div>
      <div class="panel-content" id="executionPanel"></div>
    </div>
  </div>

  <!-- Document overlay -->
  <div id="documentOverlay" style="display: none;">
    <div id="documentModal">
      <h2 id="documentTitle"></h2>
      <div id="documentContent"></div>
      <div id="signatureStatus"></div>
      <button id="signBtn">Sign Agreement</button>
    </div>
  </div>
</div>
```

### WebSocket Connections

```js
function startSession(userId, roomCode, profile) {
  // Switch screens
  document.getElementById("setup").style.display = "none";
  document.getElementById("session").style.display = "flex";
  document.getElementById("roomDisplay").textContent = `Room: ${roomCode}`;

  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const baseUrl = `${wsProtocol}//${location.host}`;

  // Audio WebSocket
  const audioWs = new WebSocket(
    `${baseUrl}/ws/audio?room=${encodeURIComponent(roomCode)}&user=${encodeURIComponent(userId)}`
  );
  audioWs.binaryType = "arraybuffer";

  // Panel WebSocket
  const panelWs = new WebSocket(
    `${baseUrl}/ws/panels?room=${encodeURIComponent(roomCode)}&user=${encodeURIComponent(userId)}`
  );

  // Send profile on panel connection open
  panelWs.addEventListener("open", () => {
    panelWs.send(JSON.stringify({ type: "set_profile", profile }));
    // Also tell server to join the room
    panelWs.send(JSON.stringify({ type: "join_room", roomId: roomCode }));
  });

  // Start mic capture when audio WS opens
  audioWs.addEventListener("open", () => {
    startMicrophone(audioWs);
  });

  // Handle incoming audio (playback from other user)
  setupAudioPlayback(audioWs);

  // Handle panel messages
  setupPanelHandler(panelWs, userId);
}
```

### Microphone Capture

```js
async function startMicrophone(audioWs) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      if (audioWs.readyState !== WebSocket.OPEN) return;
      const float32 = event.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      audioWs.send(int16.buffer);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  } catch (err) {
    console.error("Microphone error:", err);
    document.getElementById("statusText").textContent = "Microphone access denied";
    document.getElementById("statusDot").className = "status-dot error";
  }
}
```

### Audio Playback (from other user)

```js
function setupAudioPlayback(audioWs) {
  let playbackContext = null;
  let nextPlayTime = 0;

  audioWs.addEventListener("message", (event) => {
    if (typeof event.data === "string") return; // ignore text

    if (!playbackContext) {
      playbackContext = new AudioContext({ sampleRate: 16000 });
      nextPlayTime = playbackContext.currentTime;
    }

    const int16 = new Int16Array(event.data);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
    }

    const buffer = playbackContext.createBuffer(1, float32.length, 16000);
    buffer.getChannelData(0).set(float32);

    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);

    // Schedule slightly ahead to avoid gaps
    const now = playbackContext.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  });
}
```

### Panel Message Handler

```js
function setupPanelHandler(panelWs, myUserId) {
  panelWs.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.panel) {
        case "transcript": handleTranscript(msg, myUserId); break;
        case "agent": handleAgent(msg); break;
        case "negotiation": handleNegotiation(msg); break;
        case "document": handleDocument(msg, panelWs); break;
        case "execution": handleExecution(msg); break;
        case "status": handleStatus(msg); break;
        case "error": handleError(msg); break;
      }
    } catch { /* ignore malformed messages */ }
  });
}
```

### Transcript Panel

```js
function handleTranscript(msg, myUserId) {
  const panel = document.getElementById("transcriptPanel");
  const entry = msg.entry;

  if (!entry.isFinal) {
    // Update or create partial element
    let partial = document.getElementById(`partial-${entry.speaker}`);
    if (!partial) {
      partial = document.createElement("div");
      partial.id = `partial-${entry.speaker}`;
      partial.className = "transcript-partial";
      panel.appendChild(partial);
    }
    partial.textContent = `${entry.speaker}: ${entry.text}...`;
    autoScroll(panel);
    return;
  }

  // Remove partial for this speaker
  const partial = document.getElementById(`partial-${entry.speaker}`);
  if (partial) partial.remove();

  // Create final entry
  const div = document.createElement("div");
  div.className = "transcript-entry";

  const isLocal = entry.speaker === myUserId || entry.source === "local";
  const speakerSpan = document.createElement("span");
  speakerSpan.className = isLocal ? "speaker-local" : "speaker-peer";
  speakerSpan.textContent = entry.speaker + ": ";

  const textSpan = document.createElement("span");
  textSpan.textContent = entry.text;

  div.appendChild(speakerSpan);
  div.appendChild(textSpan);
  panel.appendChild(div);
  autoScroll(panel);
}
```

### Agent Panel

```js
function handleAgent(msg) {
  const panel = document.getElementById("agentPanel");
  const div = document.createElement("div");

  if (msg.text.startsWith("[Tool:")) {
    div.className = "agent-tool";
    const nameMatch = msg.text.match(/\[Tool: (.+?)\]/);
    const toolName = nameMatch ? nameMatch[1] : "unknown";
    const result = msg.text.replace(/\[Tool: .+?\] ?/, "");

    const nameEl = document.createElement("div");
    nameEl.className = "tool-name";
    nameEl.textContent = toolName;

    const resultEl = document.createElement("div");
    resultEl.className = "tool-args";
    resultEl.textContent = result;

    div.appendChild(nameEl);
    div.appendChild(resultEl);
  } else {
    div.className = "agent-response";
    div.textContent = msg.text;
  }

  panel.appendChild(div);
  autoScroll(panel);
}
```

### Negotiation Panel

```js
function handleNegotiation(msg) {
  const panel = document.getElementById("negotiationPanel");
  const neg = msg.negotiation;

  const div = document.createElement("div");
  div.className = `negotiation-entry negotiation-${neg.status}`;

  const header = document.createElement("div");
  header.className = "negotiation-header";
  header.textContent = `${neg.status.toUpperCase()} — Round ${neg.rounds.length}/${neg.maxRounds}`;

  const summary = document.createElement("div");
  summary.textContent = neg.currentProposal.summary;

  const total = document.createElement("div");
  total.className = "negotiation-amount";
  total.textContent = `Total: £${(neg.currentProposal.totalAmount / 100).toFixed(2)}`;

  const items = document.createElement("ul");
  for (const li of neg.currentProposal.lineItems) {
    const item = document.createElement("li");
    item.textContent = `${li.description}: £${(li.amount / 100).toFixed(2)} (${li.type})`;
    items.appendChild(item);
  }

  div.appendChild(header);
  div.appendChild(summary);
  div.appendChild(total);
  div.appendChild(items);
  panel.appendChild(div);
  autoScroll(panel);
}
```

### Document Overlay

```js
function handleDocument(msg, panelWs) {
  const overlay = document.getElementById("documentOverlay");
  const doc = msg.document;

  document.getElementById("documentTitle").textContent = doc.title;
  document.getElementById("documentContent").innerHTML = markdownToHtml(doc.content);

  updateSignatureStatus(doc);

  const signBtn = document.getElementById("signBtn");
  signBtn.onclick = () => {
    panelWs.send(JSON.stringify({ type: "sign_document", documentId: doc.id }));
    signBtn.disabled = true;
    signBtn.textContent = "Signed ✓";
  };

  overlay.style.display = "flex";
}

function updateSignatureStatus(doc) {
  const el = document.getElementById("signatureStatus");
  const signed = doc.signatures.length;
  const total = doc.parties.length;
  el.textContent = `Signatures: ${signed}/${total}`;
  if (doc.status === "fully_signed") {
    el.textContent += " — Agreement Complete!";
    document.getElementById("documentOverlay").classList.add("completed");
  }
}
```

### Simple Markdown → HTML Converter

```js
function markdownToHtml(md) {
  // Basic markdown conversion — NOT for untrusted input (we trust the LLM output here)
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>");
}
```

### Execution Panel

```js
function handleExecution(msg) {
  const panel = document.getElementById("executionPanel");
  const div = document.createElement("div");
  div.className = `execution-entry execution-${msg.status === "done" ? "confirmed" : msg.status === "failed" ? "failed" : "update"}`;

  const step = document.createElement("div");
  step.className = "execution-step";
  step.textContent = msg.step;

  const status = document.createElement("div");
  status.className = "execution-status";
  status.textContent = msg.status + (msg.details ? ` — ${msg.details}` : "");

  div.appendChild(step);
  div.appendChild(status);
  panel.appendChild(div);
  autoScroll(panel);
}
```

### Status Handler

```js
function handleStatus(msg) {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");

  if (msg.users && msg.users.length >= 2) {
    dot.className = "status-dot connected";
    text.textContent = `Connected — ${msg.sessionStatus}`;
  } else {
    dot.className = "status-dot waiting";
    text.textContent = "Waiting for partner...";
  }
}

function handleError(msg) {
  const dot = document.getElementById("statusDot");
  dot.className = "status-dot error";
  document.getElementById("statusText").textContent = `Error: ${msg.message}`;
}
```

### Auto-scroll

```js
function autoScroll(container) {
  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  if (isNearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}
```

---

## CSS (Complete)

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  background: #0a0a0a;
  color: #e0e0e0;
  height: 100vh;
  overflow: hidden;
}

/* Setup screen */
#setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  overflow-y: auto;
}
#setup h1 { color: #2d9c3c; margin-bottom: 24px; font-size: 32px; }
#setup h3 { color: #888; margin: 16px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
#setup form { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 400px; }
#setup input, #setup select, #setup textarea {
  background: #1a1a1a; border: 1px solid #333; color: #e0e0e0;
  padding: 10px 14px; font-size: 14px; font-family: inherit; border-radius: 4px;
}
#setup textarea { min-height: 60px; resize: vertical; }
#setup label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #aaa; }
#setup label input, #setup label select { flex: 1; }
#setup button {
  background: #2d9c3c; color: white; border: none; padding: 12px;
  font-size: 16px; font-family: inherit; border-radius: 4px; cursor: pointer; margin-top: 16px;
}
#setup button:hover { background: #238b31; }
#setupStatus { color: #e74c3c; font-size: 14px; margin-top: 8px; }

/* Session screen */
#session { display: none; height: 100vh; flex-direction: column; }

/* Status bar */
.status-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px; background: #111; border-bottom: 1px solid #222; font-size: 14px;
}
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: #f5a623; }
.status-dot.connected { background: #2d9c3c; }
.status-dot.error { background: #e74c3c; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.status-dot.waiting { animation: pulse 1.5s infinite; }

/* Panel grid — 4 panels */
.panels {
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
  flex: 1; gap: 1px; background: #222; overflow: hidden;
}
.panel { background: #0a0a0a; display: flex; flex-direction: column; overflow: hidden; }
.panel-header {
  padding: 8px 12px; background: #111; border-bottom: 1px solid #222;
  font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #666;
}
.panel-content { flex: 1; overflow-y: auto; padding: 8px 12px; }

/* Transcript */
.transcript-entry { margin-bottom: 8px; line-height: 1.4; }
.speaker-local { color: #2d9c3c; font-weight: bold; }
.speaker-peer { color: #3498db; font-weight: bold; }
.transcript-partial { color: #666; font-style: italic; margin-bottom: 4px; }

/* Agent */
.agent-response { margin-bottom: 8px; padding: 6px 8px; background: #1a1a2e; border-radius: 4px; }
.agent-tool { margin-bottom: 8px; padding: 6px 8px; border-left: 3px solid #8e44ad; background: #1a1a1a; }
.tool-name { color: #8e44ad; font-weight: bold; font-size: 12px; }
.tool-args { color: #888; font-size: 11px; white-space: pre-wrap; }

/* Negotiation */
.negotiation-entry { margin-bottom: 8px; padding: 8px; border-radius: 4px; }
.negotiation-proposed { border: 1px solid #f5a623; background: #1a1500; }
.negotiation-countering { border: 1px solid #3498db; background: #0a1a2a; }
.negotiation-accepted { border: 1px solid #2d9c3c; background: #0a1a0a; }
.negotiation-rejected { border: 1px solid #e74c3c; background: #1a0a0a; }
.negotiation-expired { border: 1px solid #666; background: #111; }
.negotiation-header { font-size: 12px; font-weight: bold; margin-bottom: 4px; }
.negotiation-amount { color: #2d9c3c; font-size: 16px; font-weight: bold; margin: 4px 0; }
.negotiation-entry ul { margin-left: 16px; font-size: 12px; color: #aaa; }

/* Execution */
.execution-entry { margin-bottom: 8px; padding: 8px; border-radius: 4px; }
.execution-confirmed { border: 1px solid #2d9c3c; background: #0a1a0a; }
.execution-failed { border: 1px solid #e74c3c; background: #1a0a0a; }
.execution-update { border: 1px solid #333; background: #111; }
.execution-step { font-size: 12px; font-weight: bold; }
.execution-status { font-size: 12px; color: #aaa; }

/* Document overlay */
#documentOverlay {
  display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.8); z-index: 100;
  justify-content: center; align-items: center;
}
#documentModal {
  background: #111; border: 1px solid #333; border-radius: 8px;
  padding: 24px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto;
}
#documentModal h2 { color: #2d9c3c; margin-bottom: 16px; }
#documentContent { line-height: 1.6; margin-bottom: 16px; }
#documentContent h1, #documentContent h2, #documentContent h3 { color: #e0e0e0; margin: 12px 0 8px; }
#documentContent strong { color: #fff; }
#documentContent ul, #documentContent ol { margin-left: 20px; }
#signatureStatus { color: #f5a623; margin-bottom: 12px; font-size: 14px; }
#signBtn {
  background: #2d9c3c; color: white; border: none; padding: 12px 24px;
  font-size: 16px; font-family: inherit; border-radius: 4px; cursor: pointer;
}
#signBtn:disabled { background: #333; cursor: default; }
#documentOverlay.completed #signatureStatus { color: #2d9c3c; }

/* Mobile */
@media (max-width: 900px) {
  .panels { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
}
@media (max-width: 600px) {
  .panels { grid-template-columns: 1fr; grid-template-rows: repeat(4, 1fr); }
  .panel { max-height: 25vh; }
}
```

---

## Security: XSS Prevention

- All user-generated text (names, transcript, agent responses) uses `textContent` (NOT `innerHTML`)
- The only `innerHTML` usage is `markdownToHtml` for LLM-generated document content — acceptable because the server controls the LLM output
- Room codes and user IDs validated before sending to server

---

## Verification

- Page loads at `http://localhost:3000/`
- Profile form persists to localStorage
- Room code auto-generated (6 chars, no confusing characters)
- Joining shows session screen, connects WebSockets
- Audio captured at 16kHz, converted to Int16, sent as binary
- Audio from other user plays back smoothly
- Transcript shows local (green) and peer (blue) speakers
- Partials update in-place, finals replace partials
- Agent panel shows responses and tool calls
- Negotiation panel shows lifecycle with color-coded statuses
- Document overlay appears with sign button
- Execution panel shows payment results
- Mobile responsive (stacks panels)
