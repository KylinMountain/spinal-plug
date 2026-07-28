import type { MemoryCompilation, ProjectSnapshot, SyncFetchRequest, SyncFetchResponse, SyncPullRequest, SyncPullResponse, SyncPushRequest, SyncPushResponse } from "@spinal-plug/protocol";
/**
 * Authoritative M2 semantics without an HTTP framework or authentication.
 * The deterministic compiler lives in the client library so every device can
 * verify canonical state locally; the Control Plane wraps the same semantics
 * behind device authorization and durable storage.
 */
export declare class InMemorySyncServer {
    private nextSequence;
    private readonly eventsBySpace;
    private readonly eventsById;
    private readonly compiler;
    push(request: SyncPushRequest): Promise<SyncPushResponse>;
    pull(request: SyncPullRequest): Promise<SyncPullResponse>;
    fetchUpdates(request: SyncFetchRequest): Promise<SyncFetchResponse>;
    snapshot(spaceId: string): ProjectSnapshot;
    compilation(spaceId: string): MemoryCompilation;
}
//# sourceMappingURL=in-memory-sync-server.d.ts.map