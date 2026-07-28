import type {
  CanonicalMemoryUpdate,
  EventEnvelope,
  MemoryCompilation,
  MemoryPayload,
  MemoryRecord
} from "@spinal-plug/protocol";

function updateKind(memory: MemoryRecord): CanonicalMemoryUpdate["kind"] {
  switch (memory.status) {
    case "active": return "activate";
    case "candidate": return "candidate";
    case "disputed": return "dispute";
    case "superseded": return "supersede";
    case "deleted": return "delete";
  }
}

function allMemories(compilation: MemoryCompilation): MemoryRecord[] {
  return [
    ...compilation.active,
    ...compilation.candidates,
    ...compilation.disputed,
    ...compilation.superseded,
    ...compilation.deleted
  ];
}

export function createCanonicalUpdates(
  spaceId: string,
  pageEvents: EventEnvelope[],
  compilation: MemoryCompilation
): CanonicalMemoryUpdate[] {
  const records = new Map(allMemories(compilation).map(memory => [memory.memoryId, memory]));
  const changedMemoryIds = new Set(
    pageEvents.flatMap(event => {
      const payload = event.payload as Partial<MemoryPayload>;
      return payload.memoryId ? [payload.memoryId] : [];
    })
  );
  const generatedAt = new Date().toISOString();
  return [...changedMemoryIds].flatMap(memoryId => {
    const memory = records.get(memoryId);
    if (!memory) return [];
    return [{
      schema: "spinal-plug.canonical-memory-update/v0.1" as const,
      updateId: `upd_${memory.lastUpdatedFromEventId}`,
      spaceId,
      memoryId,
      kind: updateKind(memory),
      required: memory.status === "deleted",
      sourceEventIds: memory.sourceEventIds ?? [memory.lastUpdatedFromEventId],
      memory,
      generatedAt
    }];
  });
}
