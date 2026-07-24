import type { JsonSchema } from "./common.js";

export const projectCheckpointSchema: JsonSchema = {
  $id: "spinal-plug.project-checkpoint/v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "checkpointId",
    "spaceId",
    "title",
    "completed",
    "decisions",
    "openTasks",
    "blockers",
    "artifactRefs",
    "status",
    "sourceEventIds",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    schema: { type: "string", enum: ["spinal-plug.project-checkpoint/v0.1"] },
    checkpointId: { type: "string" },
    spaceId: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    completed: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    openTasks: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } },
    nextAction: { type: "string" },
    artifactRefs: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["active", "superseded", "archived"] },
    parentCheckpointId: { type: "string" },
    missionId: { type: "string" },
    branchId: { type: "string" },
    sourceEventIds: { type: "array", items: { type: "string" } },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
};
