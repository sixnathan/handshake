# Prompt 04 — Session Service

**Phase:** 2 (services — parallelizable)
**Depends on:** 01-types-and-interfaces
**Blocks:** Phase 3 (agent/tools), Phase 4 (orchestrators)

## Task

Create the SessionService — the conversation state machine that tracks users, peers, transcripts, negotiations, and conversation status.

---

## File: src/services/session.ts

### Class: SessionService extends EventEmitter

Implements the `ISessionService` interface.

**Private state:**
```ts
private state: LocalState
```

Initialize with default state in constructor:
```ts
{
  myUser: { userId: "", name: "", stripeAccountId: "" },
  peer: undefined,
  transcripts: { local: [], peer: [] },
  speakerMapping: {},
  negotiations: new Map(),
  status: "discovering",
}
```

**`initConversation(config: UserConfig): void`**
- Set `state.myUser = config`
- Set status to "discovering"
- Emit `"status:changed"` with "discovering"

**`setPeer(peer: PeerIdentity): void`**
- Set `state.peer = peer`
- Set status to "calibrating"
- Emit `"status:changed"` with "calibrating"

**`setSpeakerMapping(mapping: SpeakerMapping): void`**
- Set `state.speakerMapping = mapping`
- Set status to "active"
- Emit `"status:changed"` with "active"

**`addLocalTranscript(entry: TranscriptEntry): void`**
- Push entry to `state.transcripts.local`
- Emit `"transcript:new"` with entry

**`addPeerTranscript(entry: TranscriptEntry): void`**
- Push entry to `state.transcripts.peer`
- Emit `"transcript:new"` with entry

**`getState(): LocalState`**
- Return `state` (a reference is fine here since this is read-only access internally)

**`getStatus(): ConversationStatus`**
- Return `state.status`

**`getTranscriptText(): string`**
- Merge local and peer transcripts into a single sorted array by timestamp
- Format each entry as `"${entry.speaker}: ${entry.text}"`
- Join with newlines
- Return the formatted string

**`endConversation(): void`**
- Set status to "ended"
- Emit `"status:changed"` with "ended"

### Imports

```ts
import EventEmitter from "eventemitter3";
import type {
  UserConfig, PeerIdentity, SpeakerMapping, TranscriptEntry,
  LocalState, ConversationStatus,
} from "../types.js";
```

---

## Verification

- Status transitions: discovering → calibrating → active → ended
- Each transition emits "status:changed"
- addLocalTranscript/addPeerTranscript append and emit "transcript:new"
- getTranscriptText() returns chronologically sorted, formatted conversation
