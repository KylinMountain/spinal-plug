import type { JsonSchema } from "./common.js";

export const memoryRecordSchema: JsonSchema = {
  $id: "spinal-plug.memory-record/v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "memoryId",
    "spaceId",
    "kind",
    "title",
    "statement",
    "references",
    "status",
    "createdFromEventId",
    "lastUpdatedFromEventId",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    schema: { type: "string", enum: ["spinal-plug.memory-record/v0.1"] },
    memoryId: { type: "string" },
    spaceId: { type: "string" },
    kind: {
      type: "string",
      enum: ["directive", "decision", "context", "reference"]
    },
    title: { type: "string" },
    statement: { type: "string" },
    why: { type: "string" },
    howToApply: { type: "string" },
    references: {
      type: "array",
      items: { type: "string" }
    },
    status: {
      type: "string",
      enum: ["candidate", "active", "superseded", "deleted", "disputed"]
    },
    semanticKey: { type: "string" },
    origin: {
      type: "string",
      enum: ["user_explicit", "host_native", "agent_inferred", "sync_import"]
    },
    confidence: { type: "number" },
    sourceEventIds: {
      type: "array",
      items: { type: "string" }
    },
    supersededByMemoryId: { type: "string" },
    disputeId: { type: "string" },
    createdFromEventId: { type: "string" },
    lastUpdatedFromEventId: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
};
