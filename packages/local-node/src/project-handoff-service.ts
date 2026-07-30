import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type {
  EventActor,
  EventEnvelope,
  EventRuntimeContext,
  ProjectHandoff,
  ProjectSpace
} from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { valueContainsLikelySecret } from "./sensitive-data.js";

export interface CreateHandoffInput {
  space: ProjectSpace;
  title: string;
  summary?: string;
  completed?: string[];
  decisions?: string[];
  openTasks?: string[];
  blockers?: string[];
  nextAction?: string;
  artifactRefs?: string[];
  parentHandoffId?: string;
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

function assertHandoffIsSafe(handoff: ProjectHandoff): void {
  if (valueContainsLikelySecret(handoff)) {
    throw new Error("Refusing to store likely secret material in a project handoff. Store a secret reference, not the secret value.");
  }
}

/** Work-state service. Handoffs are work-state artifacts, never canonical memory. */
export class ProjectHandoffService {
  constructor(
    private readonly database: SpinalPlugDatabase,
    private readonly identity = { accountId: "local", personaId: "persona_default" },
    private readonly actorDefaults: Partial<EventActor> = {}
  ) {}

  record(input: CreateHandoffInput): ProjectHandoff {
    const timestamp = now();
    const handoffId = `hnd_${randomUUID()}`;
    const previous = input.parentHandoffId ?? this.database.latestHandoff(input.space.spaceId)?.handoffId;
    const handoff: ProjectHandoff = {
      schema: "spinal-plug.project-handoff/v0.1",
      handoffId,
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
      parentHandoffId: previous,
      missionId: input.runtimeContext?.missionId ?? null,
      branchId: input.runtimeContext?.branchId ?? null,
      sourceEventIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    assertHandoffIsSafe(handoff);
    const eventId = `evt_${randomUUID()}`;
    const event: EventEnvelope = {
      schemaVersion: 1,
      eventId,
      eventType: "handoff.created",
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
        taskCheckpointId: handoffId
      },
      payload: { handoff },
      createdAt: timestamp,
      idempotencyKey: eventId
    };
    handoff.sourceEventIds = [eventId];
    this.database.recordHandoffMutation(event, handoff);
    return handoff;
  }

  latest(space: ProjectSpace): ProjectHandoff | null {
    return this.list(space)[0] ?? null;
  }

  list(space: ProjectSpace, includeInactive = false): ProjectHandoff[] {
    return this.database.listHandoffs(space.spaceId, includeInactive)
      .filter(handoff => !valueContainsLikelySecret(handoff));
  }

  formatForBoot(space: ProjectSpace): string | null {
    const handoff = this.latest(space);
    if (!handoff) return null;
    const section = (name: string, values: string[]) => values.length ? `\n${name}:\n${values.map(value => `- ${value}`).join("\n")}` : "";
    return [
      `<spinal-plug_handoff id="${handoff.handoffId}">`,
      `Title: ${handoff.title}`,
      handoff.summary ? `Summary: ${handoff.summary}` : "",
      section("Completed", handoff.completed),
      section("Decisions", handoff.decisions),
      section("Open tasks", handoff.openTasks),
      section("Blockers", handoff.blockers),
      handoff.nextAction ? `\nNext action: ${handoff.nextAction}` : "",
      section("Artifacts", handoff.artifactRefs),
      "</spinal-plug_handoff>"
    ].filter(Boolean).join("\n");
  }
}
