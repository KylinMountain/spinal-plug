import type { AuthenticatedPrincipal, ProjectSpace, SyncFetchRequest, SyncFetchResponse, SyncPullRequest, SyncPullResponse, SyncPushRequest, SyncPushResponse } from "@spinal-plug/protocol";
import type { SyncTransport } from "./sync-client.js";
export declare class HttpSyncTransport implements SyncTransport {
    private readonly baseUrl;
    private readonly deviceToken?;
    constructor(baseUrl: string, deviceToken?: string | undefined);
    push(request: SyncPushRequest): Promise<SyncPushResponse>;
    /** Authenticated Control Planes require an explicit Space registration before events flow. */
    registerSpace(space: ProjectSpace): Promise<ProjectSpace>;
    /** Returns the credential's identity on an authenticated Control Plane; unauthenticated servers 404. */
    whoami(): Promise<AuthenticatedPrincipal>;
    pull(request: SyncPullRequest): Promise<SyncPullResponse>;
    fetchUpdates(request: SyncFetchRequest): Promise<SyncFetchResponse>;
    private request;
    private headers;
}
//# sourceMappingURL=http-sync-transport.d.ts.map