import type {
  SyncFetchRequest,
  SyncFetchResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@spinal-plug/protocol";
import type { SyncTransport } from "./sync-client.js";

export class HttpSyncTransport implements SyncTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly deviceToken?: string
  ) {}

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    return this.request("/v1/events:push", {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(request)
    });
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const query = new URLSearchParams({ space_id: request.spaceId, device_id: request.deviceId });
    if (request.cursor) query.set("cursor", request.cursor);
    if (request.limit) query.set("limit", String(request.limit));
    return this.request(`/v1/events:pull?${query.toString()}`);
  }

  async fetchUpdates(request: SyncFetchRequest): Promise<SyncFetchResponse> {
    const query = new URLSearchParams({ space_id: request.spaceId, device_id: request.deviceId });
    if (request.cursor) query.set("cursor", request.cursor);
    if (request.limit) query.set("limit", String(request.limit));
    return this.request(`/v1/updates:fetch?${query.toString()}`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: this.headers(init?.headers)
    });
    const body = await response.json() as T | { error?: string };
    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "error" in body
        ? (body as { error?: string }).error
        : undefined;
      throw new Error(message ?? `Sync request failed: ${response.status}`);
    }
    return body as T;
  }

  private headers(input?: RequestInit["headers"]): Headers {
    const headers = new Headers(input);
    if (this.deviceToken) headers.set("authorization", `Bearer ${this.deviceToken}`);
    return headers;
  }
}
