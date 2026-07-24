import type { JsonSchema } from "./common.js";

export const syncPushRequestSchema: JsonSchema = {
  $id: "spinal-plug.sync-push-request/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "deviceId", "events"],
  properties: {
    spaceId: { type: "string" },
    deviceId: { type: "string" },
    events: { type: "array" }
  }
};

export const syncPullRequestSchema: JsonSchema = {
  $id: "spinal-plug.sync-pull-request/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "deviceId"],
  properties: {
    spaceId: { type: "string" },
    deviceId: { type: "string" },
    cursor: { type: "string" },
    limit: { type: "number" }
  }
};

export const syncFetchRequestSchema: JsonSchema = {
  $id: "spinal-plug.sync-fetch-request/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "deviceId"],
  properties: {
    spaceId: { type: "string" },
    deviceId: { type: "string" },
    cursor: { type: "string" },
    limit: { type: "number" }
  }
};
