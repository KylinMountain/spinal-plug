import type {
  AuthenticatedPrincipal,
  ProjectSpace,
  SyncFetchRequest,
  SyncFetchResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@spinal-plug/protocol";
import type { SyncTransport } from "./sync-client.js";

/**
 * A sync endpoint is remote input: it can stall a request forever or answer with
 * an unbounded body, and either one hangs or exhausts a client that only awaited
 * `fetch`. Both bounds are generous enough that a healthy endpoint never meets
 * them, and both are overridable for tests and unusual deployments.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface HttpSyncTransportOptions {
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export class HttpSyncTransport implements SyncTransport {
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    private readonly baseUrl: string,
    private readonly deviceToken?: string,
    options: HttpSyncTransportOptions = {}
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    return this.request("/v1/events:push", {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(request)
    });
  }

  /** Authenticated Control Planes require an explicit Space registration before events flow. */
  async registerSpace(space: ProjectSpace): Promise<ProjectSpace> {
    return this.request("/v1/spaces", {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(space)
    });
  }

  /** Returns the credential's identity on an authenticated Control Plane; unauthenticated servers 404. */
  async whoami(): Promise<AuthenticatedPrincipal> {
    return this.request("/v1/me");
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
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    // Compose rather than replace: spreading `init` after would have dropped a
    // caller's own signal, and the deadline has to cover draining the body too —
    // a stalled body is a stalled request.
    const signal = init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
    let response: Response;
    let body: T | { error?: string };
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        ...init,
        headers: this.headers(init?.headers),
        signal
      });
      body = await this.readJson<T | { error?: string }>(response, path);
    } catch (error) {
      if (timeout.aborted) {
        throw new Error(`Sync request to ${path} timed out after ${this.requestTimeoutMs}ms`);
      }
      throw error;
    }
    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "error" in body
        ? (body as { error?: string }).error
        : undefined;
      throw new Error(message ?? `Sync request failed: ${response.status}`);
    }
    return body as T;
  }

  /**
   * Reads the body with a hard ceiling. `response.json()` would buffer whatever
   * the endpoint sends, and a `content-length` header is a claim, not a limit —
   * so the stream is counted as it arrives and abandoned the moment it exceeds
   * the cap.
   */
  private async readJson<T>(response: Response, path: string): Promise<T> {
    // An empty body is only tolerable on an error response, where the status is
    // the message. Tolerating it on a 200 would hand the caller `{}` and crash it
    // later on `result.updates.length` — further from the cause than a parse
    // error at the source.
    const empty = (): T => {
      if (response.ok) throw new Error(`Sync response from ${path} was empty`);
      return {} as T;
    };
    const stream = response.body;
    if (!stream) return empty();
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        size += chunk.value.byteLength;
        if (size > this.maxResponseBytes) {
          throw new Error(`Sync response from ${path} exceeded ${this.maxResponseBytes} bytes`);
        }
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text.trim()) return empty();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Sync response from ${path} was not valid JSON`);
    }
  }

  private headers(input?: RequestInit["headers"]): Headers {
    const headers = new Headers(input);
    if (this.deviceToken) headers.set("authorization", `Bearer ${this.deviceToken}`);
    return headers;
  }
}
