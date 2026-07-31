import type { JsonSchema } from "./common.js";
import { eventEnvelopeSchema } from "./event-envelope.js";

/**
 * A push is remote input to whoever validates it. An unbounded array of
 * unvalidated members lets one request carry a batch no server intended to
 * accept, so the batch is capped and each member has to be an event envelope.
 * The cap matches the client's largest batch with room to spare.
 */
const MAX_EVENTS_PER_PUSH = 500;

export const syncPushRequestSchema: JsonSchema = {
  $id: "spinal-plug.sync-push-request/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "deviceId", "events"],
  properties: {
    spaceId: { type: "string" },
    deviceId: { type: "string" },
    events: {
      type: "array",
      maxItems: MAX_EVENTS_PER_PUSH,
      items: eventEnvelopeSchema
    }
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
    limit: { type: "number", minimum: 1, maximum: MAX_EVENTS_PER_PUSH }
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
    limit: { type: "number", minimum: 1, maximum: MAX_EVENTS_PER_PUSH }
  }
};
