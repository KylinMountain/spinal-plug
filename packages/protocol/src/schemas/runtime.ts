import type { JsonSchema } from "./common.js";

/** Runtime entities are versioned events; the detailed shape lives in the TypeScript protocol. */
export const runtimePayloadSchema: JsonSchema = {
  $id: "spinal-plug.runtime-payload/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["entityType", "entity"],
  properties: {
    entityType: {
      type: "string",
      enum: ["mind_core", "role_profile", "mission", "task_graph", "mind_capsule", "incarnation"]
    },
    entity: { type: "object" }
  }
};
