import { createServer, type IncomingMessage, type Server } from "node:http";
import { PersistentSyncServer } from "./persistent-server.js";

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_000_000) throw new Error("Request body exceeds 1 MB limit.");
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export interface SyncHttpServer {
  server: Server;
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

/** Minimal HTTP envelope around the durable sync contract. Authentication is intentionally external to this M2 slice. */
export function createSyncHttpServer(sync: PersistentSyncServer): SyncHttpServer {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "POST" && url.pathname === "/v1/events:push") {
        sendJson(response, 200, await sync.push(await readJson(request) as Parameters<PersistentSyncServer["push"]>[0]));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/events:pull") {
        const spaceId = url.searchParams.get("space_id");
        const deviceId = url.searchParams.get("device_id");
        if (!spaceId || !deviceId) throw new Error("space_id and device_id are required.");
        const limitValue = url.searchParams.get("limit");
        sendJson(response, 200, await sync.pull({
          spaceId,
          deviceId,
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit: limitValue ? Number(limitValue) : undefined
        }));
        return;
      }
      const snapshotMatch = /^\/v1\/spaces\/([^/]+)\/snapshot$/.exec(url.pathname);
      if (request.method === "GET" && snapshotMatch) {
        sendJson(response, 200, sync.snapshot(decodeURIComponent(snapshotMatch[1])));
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    server,
    listen(port: number, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  };
}
