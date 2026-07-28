import { createCanonicalUpdates } from "./canonical-updates.js";
import { MemoryCompiler } from "./memory-compiler.js";
function cursorFor(sequence) {
    return `cur:${sequence}`;
}
function parseCursor(cursor) {
    if (!cursor)
        return 0;
    const match = /^cur:(\d+)$/.exec(cursor);
    if (!match)
        throw new Error(`Invalid sync cursor: ${cursor}`);
    return Number(match[1]);
}
/**
 * Authoritative M2 semantics without an HTTP framework or authentication.
 * The deterministic compiler lives in the client library so every device can
 * verify canonical state locally; the Control Plane wraps the same semantics
 * behind device authorization and durable storage.
 */
export class InMemorySyncServer {
    nextSequence = 1;
    eventsBySpace = new Map();
    eventsById = new Map();
    compiler = new MemoryCompiler();
    async push(request) {
        const acceptedEventIds = [];
        const duplicateEventIds = [];
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
    async pull(request) {
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
    async fetchUpdates(request) {
        const after = parseCursor(request.cursor);
        const limit = Math.min(Math.max(request.limit ?? 50, 1), 200);
        const allEvents = this.eventsBySpace.get(request.spaceId) ?? [];
        const matching = allEvents.filter(item => item.sequence > after);
        const page = matching.slice(0, limit);
        const lastSequence = page.at(-1)?.sequence ?? after;
        const compilation = this.compiler.compile(request.spaceId, allEvents);
        return {
            updates: createCanonicalUpdates(request.spaceId, page.map(item => item.event), compilation),
            nextCursor: cursorFor(lastSequence),
            hasMore: matching.length > page.length
        };
    }
    snapshot(spaceId) {
        const events = this.eventsBySpace.get(spaceId) ?? [];
        const compilation = this.compiler.compile(spaceId, events);
        return {
            schema: "spinal-plug.project-snapshot/v0.1",
            spaceId,
            cursor: cursorFor(events.at(-1)?.sequence ?? 0),
            generatedAt: new Date().toISOString(),
            memories: compilation.active,
            candidates: compilation.candidates,
            disputes: compilation.disputes,
            superseded: compilation.superseded
        };
    }
    compilation(spaceId) {
        return this.compiler.compile(spaceId, this.eventsBySpace.get(spaceId) ?? []);
    }
}
//# sourceMappingURL=in-memory-sync-server.js.map