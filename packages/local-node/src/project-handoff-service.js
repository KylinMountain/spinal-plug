import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { valueContainsLikelySecret } from "./sensitive-data.js";
function now() {
    return new Date().toISOString();
}
function compact(values) {
    return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
}
function actor(overrides = {}) {
    return {
        deviceId: `device:${hostname()}`,
        agentInstallationId: "spinal-plug-cli",
        host: "spinal-plug",
        sessionId: "local",
        adapterVersion: "0.1.0",
        ...overrides
    };
}
function assertCheckpointIsSafe(checkpoint) {
    if (valueContainsLikelySecret(checkpoint)) {
        throw new Error("Refusing to store likely secret material in a project checkpoint. Store a secret reference, not the secret value.");
    }
}
/** Work-state service. Checkpoints are handoff artifacts, never canonical memory. */
export class ProjectHandoffService {
    database;
    identity;
    actorDefaults;
    constructor(database, identity = { accountId: "local", personaId: "persona_default" }, actorDefaults = {}) {
        this.database = database;
        this.identity = identity;
        this.actorDefaults = actorDefaults;
    }
    checkpoint(input) {
        const timestamp = now();
        const checkpointId = `chk_${randomUUID()}`;
        const previous = input.parentCheckpointId ?? this.database.latestCheckpoint(input.space.spaceId)?.checkpointId;
        const checkpoint = {
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
        const event = {
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
    latest(space) {
        return this.list(space)[0] ?? null;
    }
    list(space, includeInactive = false) {
        return this.database.listCheckpoints(space.spaceId, includeInactive)
            .filter(checkpoint => !valueContainsLikelySecret(checkpoint));
    }
    formatForBoot(space) {
        const checkpoint = this.latest(space);
        if (!checkpoint)
            return null;
        const section = (name, values) => values.length ? `\n${name}:\n${values.map(value => `- ${value}`).join("\n")}` : "";
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
//# sourceMappingURL=project-handoff-service.js.map