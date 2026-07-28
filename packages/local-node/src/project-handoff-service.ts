import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type {
  EventActor,
  EventEnvelope,
  EventRuntimeContext,
  ProjectCheckpoint,
  ProjectSpace
} from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { valueContainsLikelySecret } from "./sensitive-data.js";

export interface CreateCheckpointInput {
  space: ProjectSpace;
  title: string;
  summary?: string;
  completed?: string[];
  decisions?: string[];
  openTasks?: string[];
  blockers?: string[];
  nextAction?: string;
  artifactRefs?: string[];
  parentCheckpointId?: string;
  actor?: Partial<EventActor>;
  runtimeContext?: Partial<EventRuntimeContext>;
}

function now(): string {
  return new Date().toISOString();
}

function compact(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
}

function actor(overrides: Partial<EventActor> = {}): EventActor {
  return {
    deviceId: `device:${hostname()}`,
    agentInstallationId: "spinal-plug-cli",
    host: "spinal-plug",
    sessionId: "local",
    adapterVersion: "0.1.0",
    ...overrides
  };
}

function assertCheckpointIsSafe(checkpoint: ProjectCheckpoint): void {
  if (valueContainsLikelySecret(checkpoint)) {
    throw new Error("Refusing to store likely secret material in a project checkpoint. Store a secret reference, not the secret value.");
  }
}

/** Work-state service. Checkpoints are handoff artifacts, never canonical memory. */
export class ProjectHandoffService {
  constructor(
    private readonly database: SpinalPlugDatabase,
    private readonly identity = { accountId: "local", personaId: "persona_default" },
    private readonly actorDefaults: Partial<EventActor> = {}
  ) {}

  checkpoint(input: CreateCheckpointInput): ProjectCheckpoint {
    const timestamp = now();
    const checkpointId = `chk_${randomUUID()}`;
    const previous = input.parentCheckpointId ?? this.database.latestCheckpoint(input.space.spaceId)?.checkpointId;
    const checkpoint: ProjectCheckpoint = {
      schema: "spinal-plug.project-checkpoint/v0.1",
      checkpointId,
      spaceId: input.space.spaceId,
      title: input.title.trim(),
      summary: input.summary?.trim() || undefined,
      completed: compact(input.completed),
      decisions: compact(input.decisions),
      openTasks: compact(input.openTasks),
      blockers: compact(input.blockers),
      nextAction: input.nextAction?.trim() || undefined,
      artifactRefs: compact(input.artifactRefs),
      status: "active",
      parentCheckpointId: previous,
      missionId: input.runtimeContext?.missionId ?? null,
      branchId: input.runtimeContext?.branchId ?? null,
      sourceEventIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    assertCheckpointIsSafe(checkpoint);
    const eventId = `evt_${randomUUID()}`;
    const event: EventEnvelope = {
      schemaVersion: 1,
      eventId,
      eventType: "checkpoint.created",
      eventVersion: 1,
      accountId: this.identity.accountId,
      personaId: this.identity.personaId,
      spaceId: input.space.spaceId,
      actor: actor({ ...this.actorDefaults, ...input.actor }),
      causality: { parentEventIds: previous ? [previous] : [] },
      runtimeContext: {
        incarnationId: input.runtimeContext?.incarnationId ?? null,
        roleProfileId: input.runtimeContext?.roleProfileId ?? null,
        missionId: input.runtimeContext?.missionId ?? null,
        branchId: input.runtimeContext?.branchId ?? null,
        taskCheckpointId: checkpointId
      },
      payload: { checkpoint },
      createdAt: timestamp,
      idempotencyKey: eventId
    };
    checkpoint.sourceEventIds = [eventId];
    this.database.recordCheckpointMutation(event, checkpoint);
    return checkpoint;
  }

  latest(space: ProjectSpace): ProjectCheckpoint | null {
    return this.list(space)[0] ?? null;
  }

  list(space: ProjectSpace, includeInactive = false): ProjectCheckpoint[] {
    return this.database.listCheckpoints(space.spaceId, includeInactive)
      .filter(checkpoint => !valueContainsLikelySecret(checkpoint));
  }

  formatForBoot(space: ProjectSpace): string | null {
    const checkpoint = this.latest(space);
    if (!checkpoint) return null;
    const section = (name: string, values: string[]) => values.length ? `\n${name}:\n${values.map(value => `- ${value}`).join("\n")}` : "";
    return [
      `<spinal-plug_handoff checkpoint="${checkpoint.checkpointId}">`,
      `Title: ${checkpoint.title}`,
      checkpoint.summary ? `Summary: ${checkpoint.summary}` : "",
      section("Completed", checkpoint.completed),
      section("Decisions", checkpoint.decisions),
      section("Open tasks", checkpoint.openTasks),
      section("Blockers", checkpoint.blockers),
      checkpoint.nextAction ? `\nNext action: ${checkpoint.nextAction}` : "",
      section("Artifacts", checkpoint.artifactRefs),
      "</spinal-plug_handoff>"
    ].filter(Boolean).join("\n");
  }
}
