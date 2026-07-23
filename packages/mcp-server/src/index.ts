import type { MemoryRecord, ProjectSpace } from "@mind-palace/protocol";
import { MindPalaceDatabase, ProjectMemoryService, ProjectSpaceResolver } from "@mind-palace/local-node";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MindPalaceStatus {
  space: ProjectSpace | null;
  activeMemoryCount: number;
  pendingOutboxEvents: number;
}

/**
 * Host-neutral tool implementation. Transport wiring stays outside M1 so the
 * same service can be exposed by each host's public MCP configuration.
 */
export class MindPalaceMcpServer {
  private readonly memories: ProjectMemoryService;
  private readonly spaces = new ProjectSpaceResolver();

  constructor(private readonly database: MindPalaceDatabase) {
    this.memories = new ProjectMemoryService(database);
  }

  listTools(): McpToolDescriptor[] {
    return [
      {
        name: "mind-palace_status",
        description: "Return local Mind Palace project memory and Outbox status.",
        inputSchema: {
          type: "object",
          properties: { cwd: { type: "string" } },
          required: ["cwd"]
        }
      },
      {
        name: "mind-palace_recall",
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

  status(cwd: string): MindPalaceStatus {
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
      throw new Error("Mind Palace Project Space is not initialized for this directory.");
    }
    return this.memories.recall(space, query);
  }
}
