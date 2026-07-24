import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type ServerOptions as TlsServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import type { ProjectSpace, SpaceRole } from "@mind-palace/protocol";
import { ControlPlaneError, MindPalaceControlPlane } from "./control-plane.js";
import { renderControlPlaneConsole } from "./console-html.js";

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_000_000) {
      throw new ControlPlaneError("Request body exceeds 1 MB.", 413, "body_too_large");
    }
  }
  try {
    return body ? JSON.parse(body) as Record<string, unknown> : {};
  } catch {
    throw new ControlPlaneError("Request body must be valid JSON.", 400, "invalid_json");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ControlPlaneError(`${key} is required.`, 400, "invalid_request");
  }
  return value.trim();
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  const match = authorization && /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new ControlPlaneError("Bearer device credential required.", 401, "missing_token");
  return match[1];
}

function secretsEqual(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { startsAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  check(key: string, currentTime = Date.now()): void {
    const current = this.windows.get(key);
    if (!current || currentTime - current.startsAt >= this.windowMs) {
      this.windows.set(key, { startsAt: currentTime, count: 1 });
      return;
    }
    if (current.count >= this.limit) {
      throw new ControlPlaneError("Rate limit exceeded.", 429, "rate_limited");
    }
    current.count += 1;
  }
}

export interface ControlPlaneHttpOptions {
  bootstrapToken: string;
  tls?: TlsServerOptions;
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
}

export interface ControlPlaneHttpServer {
  readonly secure: boolean;
  listen(port: number, host?: string): Promise<void>;
  address(): AddressInfo | null;
  close(): Promise<void>;
}

/**
 * Authenticated HTTP control plane. Plain HTTP is intentionally restricted to
 * loopback; a non-loopback deployment must provide TLS key/certificate options.
 */
export function createControlPlaneHttpServer(
  controlPlane: MindPalaceControlPlane,
  options: ControlPlaneHttpOptions
): ControlPlaneHttpServer {
  if (!options.bootstrapToken) {
    throw new Error("A non-empty control-plane bootstrap token is required.");
  }
  const limiter = new FixedWindowRateLimiter(
    options.rateLimit?.requests ?? 120,
    options.rateLimit?.windowMs ?? 60_000
  );

  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok", secure: Boolean(options.tls) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "public, max-age=86400" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/console") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        response.end(renderControlPlaneConsole());
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/bootstrap") {
        const supplied = request.headers["x-mind-palace-bootstrap-token"];
        if (typeof supplied !== "string" || !secretsEqual(supplied, options.bootstrapToken)) {
          throw new ControlPlaneError("Invalid bootstrap credential.", 401, "invalid_bootstrap");
        }
        const body = await readJson(request);
        sendJson(response, 201, controlPlane.provisionAccount({
          accountName: requiredString(body, "accountName"),
          ownerEmail: requiredString(body, "ownerEmail"),
          ownerName: requiredString(body, "ownerName"),
          deviceName: requiredString(body, "deviceName")
        }));
        return;
      }

      const principal = controlPlane.authenticate(bearerToken(request));
      limiter.check(principal.deviceId);

      if (request.method === "POST" && url.pathname === "/v1/users") {
        const body = await readJson(request);
        const userId = controlPlane.createUser(principal, {
          email: requiredString(body, "email"),
          displayName: requiredString(body, "displayName")
        });
        sendJson(response, 201, { userId });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/devices") {
        sendJson(response, 200, { devices: controlPlane.listDevices(principal) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/devices") {
        const body = await readJson(request);
        sendJson(response, 201, controlPlane.registerDevice(
          principal,
          requiredString(body, "displayName"),
          typeof body.userId === "string" ? body.userId : undefined
        ));
        return;
      }
      const deviceMatch = /^\/v1\/devices\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && deviceMatch) {
        controlPlane.revokeDevice(principal, decodeURIComponent(deviceMatch[1]));
        sendJson(response, 200, { revoked: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/spaces") {
        sendJson(response, 200, { spaces: controlPlane.listSpaces(principal) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/spaces") {
        const body = await readJson(request);
        const space = controlPlane.createSpace(principal, {
          spaceId: requiredString(body, "spaceId"),
          type: requiredString(body, "type") as ProjectSpace["type"],
          displayName: requiredString(body, "displayName"),
          repository: body.repository as ProjectSpace["repository"],
          metadata: body.metadata as Record<string, string> | undefined
        });
        sendJson(response, 201, space);
        return;
      }
      const memberMatch = /^\/v1\/spaces\/([^/]+)\/members$/.exec(url.pathname);
      if (request.method === "POST" && memberMatch) {
        const body = await readJson(request);
        sendJson(response, 200, controlPlane.setSpaceMember(
          principal,
          decodeURIComponent(memberMatch[1]),
          requiredString(body, "userId"),
          requiredString(body, "role") as SpaceRole
        ));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/events:push") {
        sendJson(response, 200, await controlPlane.push(
          principal,
          await readJson(request) as unknown as Parameters<MindPalaceControlPlane["push"]>[1]
        ));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/events:pull") {
        const spaceId = url.searchParams.get("space_id");
        const deviceId = url.searchParams.get("device_id");
        if (!spaceId || !deviceId) {
          throw new ControlPlaneError("space_id and device_id are required.", 400, "invalid_request");
        }
        const limit = url.searchParams.get("limit");
        sendJson(response, 200, await controlPlane.pull(principal, {
          spaceId,
          deviceId,
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit: limit ? Number(limit) : undefined
        }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/updates:fetch") {
        const spaceId = url.searchParams.get("space_id");
        const deviceId = url.searchParams.get("device_id");
        if (!spaceId || !deviceId) {
          throw new ControlPlaneError("space_id and device_id are required.", 400, "invalid_request");
        }
        const limit = url.searchParams.get("limit");
        sendJson(response, 200, await controlPlane.fetchUpdates(principal, {
          spaceId,
          deviceId,
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit: limit ? Number(limit) : undefined
        }));
        return;
      }
      const snapshotMatch = /^\/v1\/spaces\/([^/]+)\/snapshot$/.exec(url.pathname);
      if (request.method === "GET" && snapshotMatch) {
        sendJson(response, 200, controlPlane.snapshot(
          principal,
          decodeURIComponent(snapshotMatch[1])
        ));
        return;
      }
      const eventsMatch = /^\/v1\/spaces\/([^/]+)\/events$/.exec(url.pathname);
      if (request.method === "GET" && eventsMatch) {
        const limit = url.searchParams.get("limit");
        sendJson(response, 200, {
          events: controlPlane.events(
            principal,
            decodeURIComponent(eventsMatch[1]),
            limit ? Number(limit) : undefined
          )
        });
        return;
      }
      const compilationMatch = /^\/v1\/spaces\/([^/]+)\/compilation$/.exec(url.pathname);
      if (request.method === "GET" && compilationMatch) {
        sendJson(response, 200, controlPlane.compilation(
          principal,
          decodeURIComponent(compilationMatch[1])
        ));
        return;
      }
      throw new ControlPlaneError("Not found.", 404, "not_found");
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        sendJson(response, error.statusCode, { error: error.message, code: error.code });
        return;
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
        code: "internal_error"
      });
    }
  };

  const server = options.tls
    ? createHttpsServer(options.tls, handler)
    : createHttpServer(handler);

  return {
    secure: Boolean(options.tls),
    listen(port: number, host = "127.0.0.1") {
      if (!options.tls && host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
        throw new Error("Non-loopback Control Plane listeners require TLS.");
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    address() {
      const address = server.address();
      return typeof address === "object" ? address : null;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  };
}
