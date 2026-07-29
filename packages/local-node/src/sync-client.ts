import { randomUUID } from "node:crypto";
import type {
  SyncApplyResult,
  SyncFetchRequest,
  SyncFetchResponse,
  SyncPreview,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { valueContainsLikelySecret } from "./sensitive-data.js";

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(request: SyncPullRequest): Promise<SyncPullResponse>;
  fetchUpdates(request: SyncFetchRequest): Promise<SyncFetchResponse>;
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
  skippedSecrets?: number;
}

export interface SynchronizeResult {
  pulled: number;
  applied: number;
  cursor: string;
}

export interface FetchResult {
  fetched: number;
  stored: number;
  handoffsStored: number;
  runtimeEntitiesStored: number;
  requiredApplied: number;
  pending: number;
  cursor: string;
}

/**
 * Transport-neutral M2 synchronizer. It makes a local write durable before
 * network activity, and only advances its cursor after remote events apply.
 */
export class SpinalPlugSyncClient {
  constructor(
    private readonly database: SpinalPlugDatabase,
    private readonly transport: SyncTransport
  ) {}

  /** Publish this device's durable local events to the Spinal Plug Control Plane. */
  async publish(spaceId: string, deviceId: string, batchSize = 50): Promise<PublishResult> {
    const pending = this.database.listPendingOutboxForSpace(spaceId, batchSize);
    if (pending.length === 0) return { pushed: 0, duplicates: 0 };

    // Secrets never leave the device: an event whose payload trips the
    // detector (anything minted before the write-time guard existed) is
    // marked delivered without being sent, so it cannot wedge the outbox
    // either. The local event log keeps it for a future controlled cleanup.
    const sendable = pending.filter(event => !valueContainsLikelySecret(event.payload));
    const skippedSecrets = pending.length - sendable.length;
    for (const event of pending) {
      if (!sendable.includes(event)) {
        this.database.markOutboxDelivered(event.eventId);
      }
    }
    if (sendable.length === 0) {
      return { pushed: 0, duplicates: 0, skippedSecrets };
    }

    const pushResult = await this.transport.push({ spaceId, deviceId, events: sendable });
    for (const eventId of [...pushResult.acceptedEventIds, ...pushResult.duplicateEventIds]) {
      this.database.markOutboxDelivered(eventId);
    }

    return {
      pushed: pushResult.acceptedEventIds.length,
      duplicates: pushResult.duplicateEventIds.length,
      skippedSecrets
    };
  }

  /** Fetch all canonical changes and apply them for Follow Stable compatibility. */
  async synchronize(spaceId: string, deviceId: string, batchSize = 50): Promise<SynchronizeResult> {
    const fetched = await this.fetch(spaceId, deviceId, batchSize);
    const applied = this.apply(spaceId);
    this.database.upsertCursor({
      schema: "spinal-plug.sync-cursor/v0.1",
      cursorId: `cur_${randomUUID()}`,
      scope: "device",
      ownerId: deviceId,
      spaceId,
      lastEventId: fetched.cursor,
      updatedAt: new Date().toISOString()
    });
    return {
      pulled: fetched.fetched,
      applied: fetched.requiredApplied + applied.applied,
      cursor: fetched.cursor
    };
  }

  /** Fetch canonical central changes into a durable inbox without applying them. */
  async fetch(spaceId: string, deviceId: string, batchSize = 50): Promise<FetchResult> {
    const cursorOwner = `fetch:${deviceId}`;
    let cursor = this.database.getCursor("adapter", cursorOwner, spaceId)?.lastEventId
      ?? this.database.getCursor("device", deviceId, spaceId)?.lastEventId;
    let fetched = 0;
    let stored = 0;
    let handoffsStored = 0;
    let runtimeEntitiesStored = 0;
    let requiredApplied = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await this.transport.fetchUpdates({
        spaceId,
        deviceId,
        cursor,
        limit: batchSize
      });
      fetched += result.updates.length;
      stored += this.database.storeCanonicalUpdates(result.updates);
      requiredApplied += this.database.applyCanonicalUpdates(spaceId, [], true).requiredApplied;
      cursor = result.nextCursor;
      this.database.upsertCursor({
        schema: "spinal-plug.sync-cursor/v0.1",
        cursorId: `cur_${randomUUID()}`,
        scope: "adapter",
        ownerId: cursorOwner,
        spaceId,
        lastEventId: cursor,
        updatedAt: new Date().toISOString()
      });
      hasMore = result.hasMore;
    }
    const runtimeCursorOwner = `runtime:${deviceId}`;
    let runtimeCursor = this.database.getCursor("adapter", runtimeCursorOwner, spaceId)?.lastEventId;
    let runtimeHasMore = true;
    while (runtimeHasMore) {
      const result = await this.transport.pull({
        spaceId,
        deviceId,
        cursor: runtimeCursor,
        limit: batchSize
      });
      handoffsStored += this.database.applyRemoteHandoffEvents(result.events);
      runtimeEntitiesStored += this.database.applyRemoteRuntimeEvents(result.events);
      runtimeCursor = result.nextCursor;
      this.database.upsertCursor({
        schema: "spinal-plug.sync-cursor/v0.1",
        cursorId: `cur_${randomUUID()}`,
        scope: "adapter",
        ownerId: runtimeCursorOwner,
        spaceId,
        lastEventId: runtimeCursor,
        updatedAt: new Date().toISOString()
      });
      runtimeHasMore = result.hasMore;
    }
    return {
      fetched,
      stored,
      handoffsStored,
      runtimeEntitiesStored,
      requiredApplied,
      pending: this.preview(spaceId).pending.length,
      cursor: cursor ?? "cur:0"
    };
  }

  preview(spaceId: string): SyncPreview {
    return this.database.previewCanonicalUpdates(spaceId);
  }

  apply(spaceId: string, updateIds?: string[]): SyncApplyResult {
    return this.database.applyCanonicalUpdates(spaceId, updateIds);
  }

  /** Legacy combined operation retained for existing M2 callers and tests. */
  async sync(spaceId: string, deviceId: string, batchSize = 50): Promise<SyncRunResult> {
    const publish = await this.publish(spaceId, deviceId, batchSize);
    const synchronize = await this.synchronize(spaceId, deviceId, batchSize);
    return { ...publish, ...synchronize };
  }
}
