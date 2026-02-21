import type WebSocket from "ws";
import type { UserId } from "../types.js";
import type { IAudioRelayService } from "../interfaces.js";

export class AudioRelayService implements IAudioRelayService {
  private sockets = new Map<UserId, WebSocket>();

  registerUser(userId: UserId, ws: WebSocket): void {
    const existing = this.sockets.get(userId);
    if (existing) {
      existing.close(4002, "replaced");
    }
    this.sockets.set(userId, ws);
    ws.on("close", () => {
      this.sockets.delete(userId);
    });
  }

  unregisterUser(userId: UserId): void {
    this.sockets.delete(userId);
  }

  relayAudio(fromUserId: UserId, buffer: Buffer): void {
    for (const [userId, ws] of this.sockets) {
      if (userId !== fromUserId && ws.readyState === ws.OPEN) {
        ws.send(buffer);
      }
    }
  }

  destroy(): void {
    this.sockets.clear();
  }
}
