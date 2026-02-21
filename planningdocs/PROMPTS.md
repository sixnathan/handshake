# Parallel Build Prompts

## Instructions

Open separate terminal windows. In each, run `cd ~/Desktop/handshake && claude`. Paste ONE prompt per instance. Wait for all in a round to finish before starting the next round.

---

## ROUND 1 — 10 instances (all independent)

### Instance 1: AudioService
```
Read planningdocs/specs/W3A-audio.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/audio.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 2: TranscriptionService
```
Read planningdocs/specs/W3B-transcription.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/transcription.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 3: AudioRelayService
```
Read planningdocs/specs/W3C-audio-relay.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/audio-relay.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 4: TriggerDetector
```
Read planningdocs/specs/W3D-trigger-detector.md, then read src/types.ts, src/interfaces.ts, and src/providers/types.ts for context. Implement exactly what the spec describes in src/services/trigger-detector.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 5: SessionService
```
Read planningdocs/specs/W3E-session.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/session.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 6: MonzoService
```
Read planningdocs/specs/W3F-monzo.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/monzo.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 7: ProfileManager
```
Read planningdocs/specs/W3G-profile-manager.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/profile-manager.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 8: InProcessPeer
```
Read planningdocs/specs/W3H-in-process-peer.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/in-process-peer.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 9: PanelEmitter
```
Read planningdocs/specs/W3I-panel-emitter.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/panel-emitter.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 10: PaymentService
```
Read planningdocs/specs/W4D-payment.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/payment.ts. Run npx tsc --noEmit when done — zero errors required.
```

---

## ROUND 2 — 3 instances (after Round 1 completes)

### Instance 1: AgentService
```
Read planningdocs/specs/W4A-agent.md, then read src/types.ts, src/interfaces.ts, and src/providers/types.ts for context. Implement exactly what the spec describes in src/services/agent.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 2: DocumentService
```
Read planningdocs/specs/W4C-document.md, then read src/types.ts, src/interfaces.ts, and src/providers/types.ts for context. Implement exactly what the spec describes in src/services/document.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 3: NegotiationService
```
Read planningdocs/specs/W4B-negotiation.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/services/negotiation.ts. Run npx tsc --noEmit when done — zero errors required.
```

---

## ROUND 3 — 2 instances (after Round 2 completes)

### Instance 1: Tools
```
Read planningdocs/specs/W6A-tools.md, then read src/types.ts and src/interfaces.ts for context. Implement exactly what the spec describes in src/tools.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 2: RoomManager
```
Read planningdocs/specs/W6B-room-manager.md, then read src/types.ts, src/interfaces.ts, and src/tools.ts for context. Implement exactly what the spec describes in src/services/room-manager.ts. This is the largest file — it imports all services and wires them together. Run npx tsc --noEmit when done — zero errors required.
```

---

## ROUND 4 — 2 instances (after Round 3 completes)

### Instance 1: Server + Entry Point
```
Read planningdocs/specs/W6C-server.md, then read src/types.ts for context. Implement exactly what the spec describes — create both src/server.ts and src/web.ts. Run npx tsc --noEmit when done — zero errors required.
```

### Instance 2: Frontend
```
Read planningdocs/specs/W7-frontend.md. Implement exactly what the spec describes in public/index.html. This is a single HTML file with embedded CSS and JS — no framework, no build step. All WebSocket URLs use /ws/audio and /ws/panels with room and user query params.
```

---

## After All Rounds

Run in one terminal:
```bash
npx tsc --noEmit          # zero errors
npm run start:web          # should print "Handshake server listening on port 3000"
curl localhost:3000/health # should return {"status":"ok"}
```
