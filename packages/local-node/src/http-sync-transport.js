export class HttpSyncTransport {
    baseUrl;
    deviceToken;
    constructor(baseUrl, deviceToken) {
        this.baseUrl = baseUrl;
        this.deviceToken = deviceToken;
    }
    async push(request) {
        return this.request("/v1/events:push", {
            method: "POST",
            headers: this.headers({ "content-type": "application/json" }),
            body: JSON.stringify(request)
        });
    }
    /** Authenticated Control Planes require an explicit Space registration before events flow. */
    async registerSpace(space) {
        return this.request("/v1/spaces", {
            method: "POST",
            headers: this.headers({ "content-type": "application/json" }),
            body: JSON.stringify(space)
        });
    }
    /** Returns the credential's identity on an authenticated Control Plane; unauthenticated servers 404. */
    async whoami() {
        return this.request("/v1/me");
    }
    async pull(request) {
        const query = new URLSearchParams({ space_id: request.spaceId, device_id: request.deviceId });
        if (request.cursor)
            query.set("cursor", request.cursor);
        if (request.limit)
            query.set("limit", String(request.limit));
        return this.request(`/v1/events:pull?${query.toString()}`);
    }
    async fetchUpdates(request) {
        const query = new URLSearchParams({ space_id: request.spaceId, device_id: request.deviceId });
        if (request.cursor)
            query.set("cursor", request.cursor);
        if (request.limit)
            query.set("limit", String(request.limit));
        return this.request(`/v1/updates:fetch?${query.toString()}`);
    }
    async request(path, init) {
        const response = await fetch(new URL(path, this.baseUrl), {
            ...init,
            headers: this.headers(init?.headers)
        });
        const body = await response.json();
        if (!response.ok) {
            const message = typeof body === "object" && body !== null && "error" in body
                ? body.error
                : undefined;
            throw new Error(message ?? `Sync request failed: ${response.status}`);
        }
        return body;
    }
    headers(input) {
        const headers = new Headers(input);
        if (this.deviceToken)
            headers.set("authorization", `Bearer ${this.deviceToken}`);
        return headers;
    }
}
//# sourceMappingURL=http-sync-transport.js.map