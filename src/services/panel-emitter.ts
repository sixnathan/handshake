import type WebSocket from "ws";
import type { UserId, RoomId, PanelMessage } from "../types.js";
import type { IPanelEmitter } from "../interfaces.js";

export class PanelEmitter implements IPanelEmitter {
  private sockets = new Map<UserId, WebSocket>();
  private roomMembership = new Map<UserId, RoomId>();

  registerSocket(userId: UserId, ws: WebSocket): void {
    const existing = this.sockets.get(userId);
    if (existing) {
      existing.close(4002, "replaced");
    }

    this.sockets.set(userId, ws);

    ws.on("close", () => {
      if (this.sockets.get(userId) === ws) {
        this.sockets.delete(userId);
        this.roomMembership.delete(userId);
      }
    });
  }

  unregisterSocket(userId: UserId): void {
    this.sockets.delete(userId);
    this.roomMembership.delete(userId);
  }

  setRoom(userId: UserId, roomId: RoomId): void {
    this.roomMembership.set(userId, roomId);
  }

  sendToUser(userId: UserId, message: PanelMessage): void {
    const ws = this.sockets.get(userId);
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  broadcast(roomId: RoomId, message: PanelMessage): void {
    const payload = JSON.stringify(message);
    let count = 0;
    for (const [userId, memberRoomId] of this.roomMembership) {
      if (memberRoomId === roomId) {
        const ws = this.sockets.get(userId);
        if (ws && ws.readyState === ws.OPEN) {
          ws.send(payload);
          count++;
        }
      }
    }
    console.log(
      `[panel] Broadcasting ${(message as Record<string, unknown>).panel} to room ${roomId} (${count} recipients)`,
    );
  }
}
