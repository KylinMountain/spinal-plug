import type { MemoryRecord } from "@spinal-plug/protocol";
export declare function containsLikelySecret(value: string): boolean;
/** Error code carried by write-time secret rejections, so permanent validation failures are identifiable without matching message text. */
export declare class SecretMaterialError extends Error {
    readonly code: "secret_material";
    constructor(message: string);
}
export declare function memoryContainsLikelySecret(memory: Pick<MemoryRecord, "title" | "statement" | "why" | "howToApply" | "references">): boolean;
/** Reject secret-shaped strings anywhere in a durable object before it is persisted or projected. */
export declare function valueContainsLikelySecret(value: unknown): boolean;
//# sourceMappingURL=sensitive-data.d.ts.map