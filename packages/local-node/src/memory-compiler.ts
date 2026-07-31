import { createHash } from "node:crypto";
import type {
  EventEnvelope,
  MemoryCompilation,
  MemoryDispute,
  MemoryOrigin,
  MemoryPayload,
  MemoryRecord,
  MemoryStatus
} from "@spinal-plug/protocol";

export interface SequencedMemoryEvent {
  sequence: number;
  event: EventEnvelope;
}

export interface MemoryCompilerOptions {
  autoPromoteThreshold?: number;
}

interface CompiledRecord extends MemoryRecord {
  sequence: number;
}

const ORIGIN_PRIORITY: Record<MemoryOrigin, number> = {
  user_explicit: 4,
  host_native: 3,
  sync_import: 2,
  agent_inferred: 1
};

/** Stable stand-in when there is no event to take a watermark from. */
const EMPTY_COMPILATION_WATERMARK = "1970-01-01T00:00:00.000Z";

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function semanticKey(payload: MemoryPayload): string {
  const supplied = payload.semanticKey?.trim();
  return supplied || `${payload.kind}:${normalize(payload.title)}`;
}

function originOf(payload: MemoryPayload): MemoryOrigin {
  return payload.origin ?? "sync_import";
}

function confidenceOf(payload: MemoryPayload): number {
  const confidence = payload.confidence ?? (originOf(payload) === "user_explicit" ? 1 : 0.8);
  return Math.min(Math.max(confidence, 0), 1);
}

function initialStatus(
  event: EventEnvelope,
  payload: MemoryPayload,
  autoPromoteThreshold: number
): MemoryStatus {
  if (event.eventType === "memory.candidate.created") return "candidate";
  if (event.eventType === "memory.promoted") return "active";
  if (originOf(payload) === "agent_inferred" && confidenceOf(payload) < autoPromoteThreshold) {
    return "candidate";
  }
  return "active";
}

function disputeId(spaceId: string, key: string, memoryIds: string[]): string {
  return `dsp_${createHash("sha256")
    .update(`${spaceId}:${key}:${[...memoryIds].sort().join(":")}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function isMemoryPayload(payload: EventEnvelope["payload"]): payload is MemoryPayload {
  const candidate = payload as Partial<MemoryPayload>;
  return Boolean(
    candidate.memoryId
    && candidate.kind
    && candidate.title
    && candidate.statement
  );
}

// A record still under review must never outrank one the user already stands
// behind, whatever its provenance or confidence.
const STATUS_PRIORITY: Partial<Record<MemoryStatus, number>> = {
  active: 3,
  disputed: 2,
  candidate: 1
};

/**
 * Orders two records for the same statement, strongest first.
 *
 * This used to pack the three signals into one number —
 * `origin * 1e6 + confidence * 1e4 + sequence` — where confidence occupied only
 * the 1e4 band, so a Space's ten-thousandth event outweighed any confidence
 * difference and its millionth outweighed provenance entirely: the winner then
 * came down to arrival order. Comparing field by field cannot overflow, and
 * status now takes part so a candidate cannot supersede an active record.
 */
function compareStrength(left: CompiledRecord, right: CompiledRecord): number {
  const statusOf = (record: CompiledRecord) => STATUS_PRIORITY[record.status] ?? 0;
  return statusOf(right) - statusOf(left)
    || ORIGIN_PRIORITY[right.origin ?? "sync_import"] - ORIGIN_PRIORITY[left.origin ?? "sync_import"]
    || (right.confidence ?? 0) - (left.confidence ?? 0)
    // Later wins among equals, and the id breaks the last tie so the result
    // never depends on input order.
    || right.sequence - left.sequence
    || left.memoryId.localeCompare(right.memoryId);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Deterministic server-side compiler for durable memory events.
 *
 * It deliberately avoids guessing whether two differently worded claims are
 * semantically equivalent. Adapters or a later semantic extraction stage
 * provide `semanticKey`; this compiler owns lineage, provenance and state.
 */
export class MemoryCompiler {
  private readonly autoPromoteThreshold: number;

  constructor(options: MemoryCompilerOptions = {}) {
    this.autoPromoteThreshold = options.autoPromoteThreshold ?? 0.92;
  }

  compile(spaceId: string, input: SequencedMemoryEvent[]): MemoryCompilation {
    const events = [...input]
      .filter(item => item.event.spaceId === spaceId && item.event.eventType.startsWith("memory."))
      .sort((left, right) => left.sequence - right.sequence);
    const eventById = new Map(events.map(item => [item.event.eventId, item.event]));
    const records = new Map<string, CompiledRecord>();
    const resolutions: Array<{ winnerId: string; resolvedIds: string[]; at: string }> = [];

    for (const { sequence, event } of events) {
      if (!isMemoryPayload(event.payload)) continue;
      const payload = event.payload;
      const existing = records.get(payload.memoryId);
      const status = event.eventType === "memory.deleted"
        ? "deleted"
        : event.eventType === "memory.updated" && existing
          ? existing.status
          : initialStatus(event, payload, this.autoPromoteThreshold);
      const sourceEventIds = unique([...(existing?.sourceEventIds ?? []), event.eventId]);
      const record: CompiledRecord = {
        schema: "spinal-plug.memory-record/v0.1",
        memoryId: payload.memoryId,
        spaceId,
        kind: payload.kind,
        title: payload.title,
        statement: payload.statement,
        why: payload.why,
        howToApply: payload.howToApply,
        references: payload.references ?? [],
        status,
        semanticKey: semanticKey(payload),
        origin: payload.origin ?? existing?.origin ?? "sync_import",
        confidence: confidenceOf(payload),
        sourceEventIds,
        createdFromEventId: existing?.createdFromEventId ?? event.eventId,
        lastUpdatedFromEventId: event.eventId,
        createdAt: existing?.createdAt ?? event.createdAt,
        updatedAt: event.createdAt,
        sequence
      };
      records.set(record.memoryId, record);

      if (event.eventType === "memory.dispute.resolved" && payload.resolvesMemoryIds?.length) {
        resolutions.push({
          winnerId: payload.memoryId,
          resolvedIds: payload.resolvesMemoryIds,
          at: event.createdAt
        });
      }
    }

    const isDescendant = (eventId: string, ancestorId: string, seen = new Set<string>()): boolean => {
      if (eventId === ancestorId) return true;
      if (seen.has(eventId)) return false;
      seen.add(eventId);
      const event = eventById.get(eventId);
      return Boolean(event?.causality.parentEventIds.some(parentId => isDescendant(parentId, ancestorId, seen)));
    };

    for (const resolution of resolutions) {
      const winner = records.get(resolution.winnerId);
      if (!winner || winner.status === "deleted") continue;
      winner.status = "active";
      // Clear the dispute marker along with the status: a resolved winner is
      // an ordinary active record, and a stale disputeId would read as an
      // unresolved conflict downstream (boot warning, palace exhibit state).
      winner.disputeId = undefined;
      winner.updatedAt = resolution.at;
      for (const resolvedId of resolution.resolvedIds) {
        if (resolvedId === winner.memoryId) continue;
        const resolved = records.get(resolvedId);
        if (!resolved || resolved.status === "deleted") continue;
        resolved.status = "superseded";
        resolved.supersededByMemoryId = winner.memoryId;
        resolved.disputeId = undefined;
      }
    }

    const groups = new Map<string, CompiledRecord[]>();
    for (const record of records.values()) {
      if (record.status === "deleted" || record.status === "superseded") continue;
      const group = groups.get(record.semanticKey ?? record.memoryId) ?? [];
      group.push(record);
      groups.set(record.semanticKey ?? record.memoryId, group);
    }

    const disputes: MemoryDispute[] = [];
    for (const [key, group] of groups) {
      const byStatement = new Map<string, CompiledRecord[]>();
      for (const record of group) {
        const variants = byStatement.get(normalize(record.statement)) ?? [];
        variants.push(record);
        byStatement.set(normalize(record.statement), variants);
      }

      const deduplicated: CompiledRecord[] = [];
      for (const variants of byStatement.values()) {
        const winner = [...variants].sort(compareStrength)[0];
        winner.sourceEventIds = unique(variants.flatMap(record => record.sourceEventIds ?? []));
        winner.references = unique(variants.flatMap(record => record.references));
        deduplicated.push(winner);
        for (const duplicate of variants) {
          if (duplicate === winner) continue;
          duplicate.status = "superseded";
          duplicate.supersededByMemoryId = winner.memoryId;
        }
      }

      const active = deduplicated.filter(record => record.status === "active");
      if (active.length <= 1) continue;

      const causalWinner = active.find(candidate =>
        active.every(other =>
          other === candidate
          || isDescendant(candidate.lastUpdatedFromEventId, other.lastUpdatedFromEventId)
        )
      );
      if (causalWinner) {
        for (const predecessor of active) {
          if (predecessor === causalWinner) continue;
          predecessor.status = "superseded";
          predecessor.supersededByMemoryId = causalWinner.memoryId;
        }
        continue;
      }

      const id = disputeId(spaceId, key, active.map(record => record.memoryId));
      for (const record of active) {
        record.status = "disputed";
        record.disputeId = id;
      }
      disputes.push({
        schema: "spinal-plug.memory-dispute/v0.1",
        disputeId: id,
        spaceId,
        semanticKey: key,
        memoryIds: active.map(record => record.memoryId).sort(),
        sourceEventIds: unique(active.flatMap(record => record.sourceEventIds ?? [])),
        reason: "concurrent_variants",
        status: "open",
        createdAt: active.map(record => record.createdAt).sort()[0]
      });
    }

    const output = [...records.values()].map(({ sequence: _sequence, ...record }) => record);
    const byUpdatedAt = (left: MemoryRecord, right: MemoryRecord) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.memoryId.localeCompare(right.memoryId);
    return {
      spaceId,
      // A wall clock here made the same input compile to a different output every
      // time, which defeats comparing or caching a compilation and contradicts
      // this class being deterministic. The watermark of the input says the same
      // thing usefully: the newest event this result accounts for. Take the
      // largest timestamp rather than the last position — events are ordered by
      // sequence, and `createdAt` comes from whichever device minted the event,
      // so a late import with an older clock would otherwise move the watermark
      // backwards. An empty input has none, and the epoch keeps that stable.
      generatedAt: events.reduce(
        (newest, { event }) => (event.createdAt > newest ? event.createdAt : newest),
        EMPTY_COMPILATION_WATERMARK
      ),
      active: output.filter(record => record.status === "active").sort(byUpdatedAt),
      candidates: output.filter(record => record.status === "candidate").sort(byUpdatedAt),
      disputed: output.filter(record => record.status === "disputed").sort(byUpdatedAt),
      superseded: output.filter(record => record.status === "superseded").sort(byUpdatedAt),
      deleted: output.filter(record => record.status === "deleted").sort(byUpdatedAt),
      disputes
    };
  }
}
