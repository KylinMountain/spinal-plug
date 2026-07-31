import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMORY_KINDS,
  isMemoryKind,
  memoryRecordSchema,
  projectSpaceSchema,
  syncPushRequestSchema
} from "./index.js";
import type { MemoryKind, ProjectSpaceType } from "./index.js";

/**
 * The schemas are the wire contract, and nothing in this package executes — so
 * the failure mode is a schema that silently disagrees with the types it is
 * supposed to describe. These tests are that agreement, checked both at compile
 * time (an exhaustive record over each union) and at runtime (the enum the
 * schema actually ships).
 */

function enumOf(schema: typeof projectSpaceSchema, property: string): string[] {
  const properties = schema.properties as Record<string, { enum?: string[] }> | undefined;
  const values = properties?.[property]?.enum;
  assert.ok(values, `${schema.$id} must constrain ${property} to an enum`);
  return [...values].sort();
}

test("the Space type enum covers every ProjectSpaceType", () => {
  // Adding a member to the union without listing it here fails to compile, so
  // this cannot drift silently in either direction.
  const everyType: Record<ProjectSpaceType, true> = { project: true, archive: true, general: true };

  assert.deepEqual(enumOf(projectSpaceSchema, "type"), Object.keys(everyType).sort());
});

test("the memory kind enum matches the runtime kind list", () => {
  const everyKind: Record<MemoryKind, true> = { directive: true, decision: true, context: true, reference: true };

  assert.deepEqual([...MEMORY_KINDS].sort(), Object.keys(everyKind).sort());
  assert.deepEqual(enumOf(memoryRecordSchema, "kind"), [...MEMORY_KINDS].sort());
});

test("isMemoryKind accepts only the declared kinds", () => {
  for (const kind of MEMORY_KINDS) assert.ok(isMemoryKind(kind));
  for (const value of ["", "directive\ninjected: yes", "DECISION", undefined, null, 7, {}]) {
    assert.equal(isMemoryKind(value), false, `${JSON.stringify(value)} is not a memory kind`);
  }
});

test("a push bounds its event batch and describes its members", () => {
  // An unbounded array of unvalidated members lets one request carry a batch no
  // server intended to accept.
  const events = (syncPushRequestSchema.properties as Record<string, Record<string, unknown>>).events;

  assert.equal(events.type, "array");
  assert.ok(typeof events.maxItems === "number" && events.maxItems > 0, "the batch needs an upper bound");
  assert.equal((events.items as { $id?: string } | undefined)?.$id, "spinal-plug.event-envelope/v0.1");
});

test("every schema is closed and self-identifying", () => {
  for (const schema of [projectSpaceSchema, memoryRecordSchema, syncPushRequestSchema]) {
    assert.match(schema.$id, /^spinal-plug\.[a-z-]+\/v\d+\.\d+$/);
    assert.equal(schema.additionalProperties, false, `${schema.$id} must reject unknown properties`);
  }
});
