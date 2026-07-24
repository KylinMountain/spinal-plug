import type { JsonSchema } from "./common.js";

export const eventEnvelopeSchema: JsonSchema = {
  $id: "mind-palace.event-envelope/v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "eventId",
    "eventType",
    "eventVersion",
    "accountId",
    "personaId",
    "spaceId",
    "actor",
    "causality",
    "runtimeContext",
    "payload",
    "createdAt",
    "idempotencyKey"
  ],
  properties: {
    schemaVersion: { type: "number" },
    eventId: { type: "string" },
    eventType: {
      type: "string",
      enum: [
        "memory.created",
        "memory.candidate.created",
        "memory.updated",
        "memory.promoted",
        "memory.dispute.resolved",
        "memory.deleted",
        "checkpoint.created",
        "checkpoint.superseded",
        "runtime.mind-core.created",
        "runtime.role-profile.created",
        "runtime.mission.created",
        "runtime.task-graph.updated",
        "runtime.capsule.created",
        "runtime.incarnation.spawned",
        "runtime.incarnation.updated",
        "sync.cursor.advanced"
      ]
    },
    eventVersion: { type: "number" },
    accountId: { type: "string" },
    personaId: { type: "string" },
    spaceId: { type: "string" },
    actor: { type: "object" },
    causality: { type: "object" },
    runtimeContext: { type: "object" },
    payload: { type: "object" },
    createdAt: { type: "string" },
    idempotencyKey: { type: "string" }
  }
};
