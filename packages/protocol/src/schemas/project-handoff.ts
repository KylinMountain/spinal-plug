import type { JsonSchema } from "./common.js";

export const projectHandoffSchema: JsonSchema = {
  $id: "spinal-plug.project-handoff/v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "handoffId",
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
    schema: { type: "string", enum: ["spinal-plug.project-handoff/v0.1"] },
    handoffId: { type: "string" },
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
    parentHandoffId: { type: "string" },
    missionId: { type: "string" },
    branchId: { type: "string" },
    sourceEventIds: { type: "array", items: { type: "string" } },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
};
