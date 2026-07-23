import type {
  EventEnvelope,
  MemoryPayload,
  MemoryRecord,
  ProjectSnapshot,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@mind-palace/protocol";

interface StoredEvent {
  sequence: number;
  event: EventEnvelope;
}

function cursorFor(sequence: number): string {
  return `cur:${sequence}`;
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^cur:(\d+)$/.exec(cursor);
  if (!match) throw new Error(`Invalid sync cursor: ${cursor}`);
  return Number(match[1]);
}

function materialize(events: StoredEvent[], spaceId: string): MemoryRecord[] {
  const records = new Map<string, MemoryRecord>();
  for (const { event } of events) {
    if (!event.eventType.startsWith("memory.")) continue;
    const payload = event.payload as Partial<MemoryPayload>;
    if (!payload.memoryId || !payload.kind || !payload.title || !payload.statement) continue;
    const existing = records.get(payload.memoryId);
    records.set(payload.memoryId, {
      schema: "mind-palace.memory-record/v0.1",
      memoryId: payload.memoryId,
      spaceId,
      kind: payload.kind,
      title: payload.title,
      statement: payload.statement,
      why: payload.why,
      howToApply: payload.howToApply,
      references: payload.references ?? [],
      status: event.eventType === "memory.deleted" ? "deleted" : "active",
      createdFromEventId: existing?.createdFromEventId ?? event.eventId,
      lastUpdatedFromEventId: event.eventId,
      createdAt: existing?.createdAt ?? event.createdAt,
      updatedAt: event.createdAt
    });
  }
  return [...records.values()].filter(memory => memory.status === "active");
}

/**
 * Authoritative M2 semantics without an HTTP framework or authentication.
 * The production API will wrap this contract behind device authorization.
 */
export class InMemorySyncServer {
  private nextSequence = 1;
  private readonly eventsBySpace = new Map<string, StoredEvent[]>();
  private readonly eventsById = new Map<string, StoredEvent>();

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const acceptedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    const spaceEvents = this.eventsBySpace.get(request.spaceId) ?? [];
    for (const event of request.events) {
      if (event.spaceId !== request.spaceId) {
        throw new Error(`Event ${event.eventId} does not belong to requested Project Space.`);
      }
      if (this.eventsById.has(event.eventId)) {
        duplicateEventIds.push(event.eventId);
        continue;
      }
      const stored = { sequence: this.nextSequence++, event };
      this.eventsById.set(event.eventId, stored);
      spaceEvents.push(stored);
      acceptedEventIds.push(event.eventId);
    }
    this.eventsBySpace.set(request.spaceId, spaceEvents);
    return {
      acceptedEventIds,
      duplicateEventIds,
      serverCursor: cursorFor(spaceEvents.at(-1)?.sequence ?? 0)
    };
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const after = parseCursor(request.cursor);
    const limit = Math.min(Math.max(request.limit ?? 50, 1), 200);
    const matching = (this.eventsBySpace.get(request.spaceId) ?? []).filter(item => item.sequence > after);
    const page = matching.slice(0, limit);
    const lastSequence = page.at(-1)?.sequence ?? after;
    return {
      events: page.map(item => item.event),
      nextCursor: cursorFor(lastSequence),
      hasMore: matching.length > page.length
    };
  }

  snapshot(spaceId: string): ProjectSnapshot {
    const events = this.eventsBySpace.get(spaceId) ?? [];
    return {
      schema: "mind-palace.project-snapshot/v0.1",
      spaceId,
      cursor: cursorFor(events.at(-1)?.sequence ?? 0),
      generatedAt: new Date().toISOString(),
      memories: materialize(events, spaceId)
    };
  }
}

export { PersistentSyncServer } from "./persistent-server.js";
export { createSyncHttpServer } from "./http-server.js";
export type { SyncHttpServer } from "./http-server.js";
