import type { JsonSchema } from "./common.js";

export const projectSpaceSchema: JsonSchema = {
  $id: "spinal-plug.project-space/v0.1",
  type: "object",
  additionalProperties: false,
  required: ["schema", "spaceId", "type", "displayName"],
  properties: {
    schema: { type: "string", enum: ["spinal-plug.project-space/v0.1"] },
    spaceId: { type: "string" },
    // Every ProjectSpaceType, not just the first one: an archive or general
    // Space is a legitimate object, and enumerating only "project" made the
    // schema reject values the type system produces.
    type: { type: "string", enum: ["project", "archive", "general"] },
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
