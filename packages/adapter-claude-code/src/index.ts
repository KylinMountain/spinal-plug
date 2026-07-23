import type {
  AdapterObservation,
  AdapterOutput,
  ContextProjection,
  HostCapabilities,
  HostHookPayload,
  MindPalaceAdapter
} from "@mind-palace/adapter-sdk";
import type { ProjectSpace } from "@mind-palace/protocol";
import { ProjectSpaceResolver } from "@mind-palace/local-node";

export class ClaudeCodeAdapter implements MindPalaceAdapter {
  readonly name = "claude-code";
  private readonly spaceResolver = new ProjectSpaceResolver();

  async detectCapabilities(): Promise<HostCapabilities> {
    return {
      host: "claude-code",
      adapterVersion: "0.1.0",
      supportedHooks: [
        "session.start",
        "prompt.submit",
        "post.tool.use",
        "pre.compact",
        "stop",
        "session.end"
      ],
      contextSinks: ["hook.additionalContext", "mcp"],
      maxContextTokens: 1500,
      supportsAsyncFetch: true
    };
  }

  async resolveProjectSpace(payload: HostHookPayload): Promise<ProjectSpace | null> {
    const existing = this.spaceResolver.resolve(payload.cwd);
    if (existing) return existing.space;
    if (payload.event !== "session.start") return null;
    return this.spaceResolver.initializeGitWorkspace(payload.cwd)?.space ?? null;
  }

  async injectContext(
    projection: ContextProjection,
    _payload: HostHookPayload
  ): Promise<AdapterOutput> {
    return {
      additionalContext: projection.content
    };
  }

  async captureObservations(payload: HostHookPayload): Promise<AdapterObservation[]> {
    // M1 only persists explicit memory commands. Automatic extraction belongs to M3.
    void payload;
    return [];
  }
}

export { ClaudeAutoMemoryImporter, ClaudeAutoMemoryMaterializer } from "./auto-memory-importer.js";
