import type { JsonSchema } from "./common.js";

export const syncCursorSchema: JsonSchema = {
  $id: "spinal-plug.sync-cursor/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["schema", "cursorId", "scope", "ownerId", "spaceId", "updatedAt"],
  properties: {
    schema: { type: "string", enum: ["spinal-plug.sync-cursor/v0.1"] },
    cursorId: { type: "string" },
    scope: { type: "string", enum: ["device", "adapter"] },
    ownerId: { type: "string" },
    spaceId: { type: "string" },
    lastEventId: { type: "string" },
    updatedAt: { type: "string" }
  }
};
