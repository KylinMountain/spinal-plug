import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  EventEnvelope,
  EventType,
  MemoryOrigin,
  MemoryPayload
} from "@spinal-plug/protocol";
import { MemoryCompiler, type SequencedMemoryEvent } from "./memory-compiler.js";

const spaceId = "spc_compiler_test";

function memoryEvent(input: {
  id: string;
  memoryId: string;
  statement: string;
  semanticKey?: string;
  eventType?: EventType;
  origin?: MemoryOrigin;
  confidence?: number;
  parents?: string[];
  resolvesMemoryIds?: string[];
  createdAt?: string;
}): EventEnvelope {
  const payload: MemoryPayload = {
    memoryId: input.memoryId,
    kind: "decision",
    title: "Queue technology",
    statement: input.statement,
    semanticKey: input.semanticKey ?? "decision:queue-technology",
    origin: input.origin ?? "user_explicit",
    confidence: input.confidence ?? 1,
    resolvesMemoryIds: input.resolvesMemoryIds
  };
  return {
    schemaVersion: 1,
    eventId: input.id,
    eventType: input.eventType ?? "memory.created",
    eventVersion: 1,
    accountId: "acc_test",
    personaId: "persona_default",
    spaceId,
    actor: {
      deviceId: `device_${input.id}`,
      agentInstallationId: "test",
      host: "test",
      sessionId: `session_${input.id}`,
      adapterVersion: "0.1.0"
    },
    causality: {
      parentEventIds: input.parents ?? []
    },
    runtimeContext: {},
    payload,
    createdAt: input.createdAt ?? `2026-07-23T10:00:${input.id.slice(-2).padStart(2, "0")}Z`,
    idempotencyKey: input.id
  };
}

function sequence(...events: EventEnvelope[]): SequencedMemoryEvent[] {
  return events.map((event, index) => ({ sequence: index + 1, event }));
}

test("keeps low-confidence inferred memory as candidate", () => {
  const compilation = new MemoryCompiler().compile(spaceId, sequence(memoryEvent({
    id: "evt_01",
    memoryId: "mem_candidate",
    statement: "Use Kafka",
    origin: "agent_inferred",
    confidence: 0.71
  })));

  assert.equal(compilation.active.length, 0);
  assert.equal(compilation.candidates.length, 1);
  assert.equal(compilation.candidates[0].status, "candidate");
});

test("merges identical variants and retains provenance", () => {
  const compilation = new MemoryCompiler().compile(spaceId, sequence(
    memoryEvent({ id: "evt_01", memoryId: "mem_a", statement: "Use Kafka" }),
    memoryEvent({
      id: "evt_02",
      memoryId: "mem_b",
      statement: "Use Kafka",
      origin: "host_native",
      confidence: 0.95
    })
  ));

  assert.equal(compilation.active.length, 1);
  assert.equal(compilation.superseded.length, 1);
  assert.deepEqual(compilation.active[0].sourceEventIds?.sort(), ["evt_01", "evt_02"]);
  assert.equal(compilation.superseded[0].supersededByMemoryId, compilation.active[0].memoryId);
});

test("marks concurrent active variants as disputed", () => {
  const compilation = new MemoryCompiler().compile(spaceId, sequence(
    memoryEvent({ id: "evt_01", memoryId: "mem_kafka", statement: "Use Kafka" }),
    memoryEvent({ id: "evt_02", memoryId: "mem_nats", statement: "Use NATS" })
  ));

  assert.equal(compilation.active.length, 0);
  assert.equal(compilation.disputed.length, 2);
  assert.equal(compilation.disputes.length, 1);
  assert.deepEqual(compilation.disputes[0].memoryIds, ["mem_kafka", "mem_nats"]);
});

test("causal replacement supersedes its predecessor", () => {
  const compilation = new MemoryCompiler().compile(spaceId, sequence(
    memoryEvent({ id: "evt_01", memoryId: "mem_kafka", statement: "Use Kafka" }),
    memoryEvent({
      id: "evt_02",
      memoryId: "mem_nats",
      statement: "Use NATS",
      parents: ["evt_01"]
    })
  ));

  assert.equal(compilation.active[0].memoryId, "mem_nats");
  assert.equal(compilation.superseded[0].memoryId, "mem_kafka");
  assert.equal(compilation.superseded[0].supersededByMemoryId, "mem_nats");
  assert.equal(compilation.disputes.length, 0);
});

test("explicit resolution closes an existing conflict", () => {
  const compilation = new MemoryCompiler().compile(spaceId, sequence(
    memoryEvent({ id: "evt_01", memoryId: "mem_kafka", statement: "Use Kafka" }),
    memoryEvent({ id: "evt_02", memoryId: "mem_nats", statement: "Use NATS" }),
    memoryEvent({
      id: "evt_03",
      memoryId: "mem_nats",
      statement: "Use NATS",
      eventType: "memory.dispute.resolved",
      resolvesMemoryIds: ["mem_kafka"]
    })
  ));

  assert.equal(compilation.active[0].memoryId, "mem_nats");
  assert.equal(compilation.active[0].disputeId, undefined, "resolved winner must not keep a stale dispute marker");
  assert.equal(compilation.superseded[0].memoryId, "mem_kafka");
  assert.equal(compilation.superseded[0].disputeId, undefined);
  assert.equal(compilation.disputes.length, 0);
});

