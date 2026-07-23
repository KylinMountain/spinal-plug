import { randomUUID } from "node:crypto";
import type {
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@mind-palace/protocol";
import { MindPalaceDatabase } from "./index.js";

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(request: SyncPullRequest): Promise<SyncPullResponse>;
}

export interface SyncRunResult {
  pushed: number;
  duplicates: number;
  pulled: number;
  applied: number;
  cursor: string;
}

export interface PublishResult {
  pushed: number;
  duplicates: number;
}

export interface SynchronizeResult {
  pulled: number;
  applied: number;
  cursor: string;
}

/**
 * Transport-neutral M2 synchronizer. It makes a local write durable before
 * network activity, and only advances its cursor after remote events apply.
 */
export class MindPalaceSyncClient {
  constructor(
    private readonly database: MindPalaceDatabase,
    private readonly transport: SyncTransport
  ) {}

  /** Publish this device's durable local events to the Mind Palace Control Plane. */
  async publish(spaceId: string, deviceId: string, batchSize = 50): Promise<PublishResult> {
    const pending = this.database.listPendingOutboxForSpace(spaceId, batchSize);
    if (pending.length === 0) return { pushed: 0, duplicates: 0 };

    const pushResult = await this.transport.push({ spaceId, deviceId, events: pending });
    for (const eventId of [...pushResult.acceptedEventIds, ...pushResult.duplicateEventIds]) {
      this.database.markOutboxDelivered(eventId);
    }

    return {
      pushed: pushResult.acceptedEventIds.length,
      duplicates: pushResult.duplicateEventIds.length
    };
  }

  /** Pull central events and apply them to this device's local materialized memory. */
  async synchronize(spaceId: string, deviceId: string, batchSize = 50): Promise<SynchronizeResult> {
    let cursor = this.database.getCursor("device", deviceId, spaceId)?.lastEventId;
    let pulled = 0;
    let applied = 0;
    let hasMore = true;
    while (hasMore) {
      const pullResult = await this.transport.pull({ spaceId, deviceId, cursor, limit: batchSize });
      pulled += pullResult.events.length;
      applied += this.database.applyRemoteMemoryEvents(pullResult.events);
      cursor = pullResult.nextCursor;
      this.database.upsertCursor({
        schema: "mind-palace.sync-cursor/v0.1",
        cursorId: `cur_${randomUUID()}`,
        scope: "device",
        ownerId: deviceId,
        spaceId,
        lastEventId: cursor,
        updatedAt: new Date().toISOString()
      });
      hasMore = pullResult.hasMore;
    }

    return { pulled, applied, cursor: cursor ?? "cur:0" };
  }

  /** Legacy combined operation retained for existing M2 callers and tests. */
  async sync(spaceId: string, deviceId: string, batchSize = 50): Promise<SyncRunResult> {
    const publish = await this.publish(spaceId, deviceId, batchSize);
    const synchronize = await this.synchronize(spaceId, deviceId, batchSize);
    return { ...publish, ...synchronize };
  }
}
