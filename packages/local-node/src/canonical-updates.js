function updateKind(memory) {
    switch (memory.status) {
        case "active": return "activate";
        case "candidate": return "candidate";
        case "disputed": return "dispute";
        case "superseded": return "supersede";
        case "deleted": return "delete";
    }
}
function allMemories(compilation) {
    return [
        ...compilation.active,
        ...compilation.candidates,
        ...compilation.disputed,
        ...compilation.superseded,
        ...compilation.deleted
    ];
}
export function createCanonicalUpdates(spaceId, pageEvents, compilation) {
    const records = new Map(allMemories(compilation).map(memory => [memory.memoryId, memory]));
    const changedMemoryIds = new Set(pageEvents.flatMap(event => {
        const payload = event.payload;
        return payload.memoryId ? [payload.memoryId] : [];
    }));
    const generatedAt = new Date().toISOString();
    return [...changedMemoryIds].flatMap(memoryId => {
        const memory = records.get(memoryId);
        if (!memory)
            return [];
        return [{
                schema: "spinal-plug.canonical-memory-update/v0.1",
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
//# sourceMappingURL=canonical-updates.js.map