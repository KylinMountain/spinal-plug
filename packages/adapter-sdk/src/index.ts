import type { EventEnvelope, ProjectionKind, ProjectSpace } from "@spinal-plug/protocol";

export type HookEventName =
  | "session.start"
  | "prompt.submit"
  | "post.tool.use"
  | "pre.compact"
  | "stop"
  | "session.end";

export interface HostCapabilities {
  host: string;
  hostVersion?: string;
  adapterVersion: string;
  supportedHooks: HookEventName[];
  contextSinks: ("hook.additionalContext" | "mcp" | "stdout.notice")[];
  maxContextTokens: number;
  supportsAsyncFetch: boolean;
}

export interface HostHookPayload {
  event: HookEventName;
  cwd: string;
  sessionId: string;
  prompt?: string;
  output?: string;
  metadata?: Record<string, string>;
}

export interface ContextProjection {
  kind: ProjectionKind;
  space: ProjectSpace;
  content: string;
  generatedAt: string;
  relatedMemoryIds: string[];
}

export interface AdapterOutput {
  additionalContext?: string;
  systemMessage?: string;
  notices?: string[];
}

export interface AdapterObservation {
  kind: "directive" | "decision" | "context" | "reference";
  title: string;
  statement: string;
  why?: string;
  howToApply?: string;
  references?: string[];
  semanticKey?: string;
  confidence: number;
  source: HookEventName;
}

export interface FutureRuntimeReservation {
  incarnationId?: string | null;
  roleProfileId?: string | null;
  missionId?: string | null;
  branchId?: string | null;
  taskCheckpointId?: string | null;
}

export interface SpinalPlugAdapter {
  readonly name: string;
  detectCapabilities(): Promise<HostCapabilities>;
  resolveProjectSpace(payload: HostHookPayload): Promise<ProjectSpace | null>;
  injectContext(projection: ContextProjection, payload: HostHookPayload): Promise<AdapterOutput>;
  captureObservations(payload: HostHookPayload): Promise<AdapterObservation[]>;
  toEventEnvelopes?(observations: AdapterObservation[], payload: HostHookPayload): Promise<EventEnvelope[]>;
}
