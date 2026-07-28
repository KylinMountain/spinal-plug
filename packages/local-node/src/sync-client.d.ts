import type { SyncApplyResult, SyncFetchRequest, SyncFetchResponse, SyncPreview, SyncPullRequest, SyncPullResponse, SyncPushRequest, SyncPushResponse } from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
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
    checkpointsStored: number;
    runtimeEntitiesStored: number;
    requiredApplied: number;
    pending: number;
    cursor: string;
}
/**
 * Transport-neutral M2 synchronizer. It makes a local write durable before
 * network activity, and only advances its cursor after remote events apply.
 */
export declare class SpinalPlugSyncClient {
    private readonly database;
    private readonly transport;
    constructor(database: SpinalPlugDatabase, transport: SyncTransport);
    /** Publish this device's durable local events to the Spinal Plug Control Plane. */
    publish(spaceId: string, deviceId: string, batchSize?: number): Promise<PublishResult>;
    /** Fetch all canonical changes and apply them for Follow Stable compatibility. */
    synchronize(spaceId: string, deviceId: string, batchSize?: number): Promise<SynchronizeResult>;
    /** Fetch canonical central changes into a durable inbox without applying them. */
    fetch(spaceId: string, deviceId: string, batchSize?: number): Promise<FetchResult>;
    preview(spaceId: string): SyncPreview;
    apply(spaceId: string, updateIds?: string[]): SyncApplyResult;
    /** Legacy combined operation retained for existing M2 callers and tests. */
    sync(spaceId: string, deviceId: string, batchSize?: number): Promise<SyncRunResult>;
}
//# sourceMappingURL=sync-client.d.ts.map