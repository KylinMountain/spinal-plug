import type { JsonSchema } from "./common.js";

export const projectSpaceSchema: JsonSchema = {
  $id: "mind-palace.project-space/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["schema", "spaceId", "type", "displayName"],
  properties: {
    schema: { type: "string", enum: ["mind-palace.project-space/v0.1"] },
    spaceId: { type: "string" },
    type: { type: "string", enum: ["project"] },
    displayName: { type: "string" },
    repository: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "canonicalRemote"],
      properties: {
        provider: {
          type: "string",
          enum: ["github", "gitlab", "generic-git"]
        },
        canonicalRemote: { type: "string" },
        defaultBranch: { type: "string" }
      }
    },
    metadata: {
      type: "object"
    }
  }
};

