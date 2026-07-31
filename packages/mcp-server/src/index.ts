import type { MemoryRecord, ProjectSpace } from "@spinal-plug/protocol";
import { SpinalPlugDatabase, ProjectMemoryService, ProjectSpaceResolver } from "@spinal-plug/local-node";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SpinalPlugStatus {
  space: ProjectSpace | null;
  activeMemoryCount: number;
  pendingOutboxEvents: number;
}

/**
 * Host-neutral tool implementation. Transport wiring stays outside M1 so the
 * same service can be exposed by each host's public MCP configuration.
 */
export interface SpinalPlugMcpServerOptions {
  /** Test seam; production resolves bindings from the real home directory. */
  homeDirectory?: string;
}

export class SpinalPlugMcpServer {
  private readonly memories: ProjectMemoryService;
  private readonly spaces: ProjectSpaceResolver;

  constructor(private readonly database: SpinalPlugDatabase, options: SpinalPlugMcpServerOptions = {}) {
    this.memories = new ProjectMemoryService(database);
    this.spaces = new ProjectSpaceResolver(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {});
  }

  listTools(): McpToolDescriptor[] {
    return [
      {
        name: "spinal-plug_status",
        description: "Return local Spinal Plug project memory and Outbox status.",
        inputSchema: {
          type: "object",
          properties: { cwd: { type: "string" } },
          required: ["cwd"]
        }
      },
      {
        name: "spinal-plug_recall",
        description: "Recall active project memories relevant to the current task.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: { type: "string" },
            query: { type: "string" }
          },
          required: ["cwd", "query"]
        }
      }
    ];
  }

  status(cwd: string): SpinalPlugStatus {
    const space = this.spaces.resolve(cwd)?.space ?? null;
    return {
      space,
      activeMemoryCount: space ? this.memories.list(space).length : 0,
      pendingOutboxEvents: this.database.listPendingOutbox().length
    };
  }

  recall(cwd: string, query: string): MemoryRecord[] {
    const space = this.spaces.resolve(cwd)?.space;
    if (!space) {
      throw new Error("Spinal Plug Project Space is not initialized for this directory.");
    }
    return this.memories.recall(space, query);
  }
}
