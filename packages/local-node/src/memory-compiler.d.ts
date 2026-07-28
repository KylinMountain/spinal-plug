import type { EventEnvelope, MemoryCompilation } from "@spinal-plug/protocol";
export interface SequencedMemoryEvent {
    sequence: number;
    event: EventEnvelope;
}
export interface MemoryCompilerOptions {
    autoPromoteThreshold?: number;
}
/**
 * Deterministic server-side compiler for durable memory events.
 *
 * It deliberately avoids guessing whether two differently worded claims are
 * semantically equivalent. Adapters or a later semantic extraction stage
 * provide `semanticKey`; this compiler owns lineage, provenance and state.
 */
export declare class MemoryCompiler {
    private readonly autoPromoteThreshold;
    constructor(options?: MemoryCompilerOptions);
    compile(spaceId: string, input: SequencedMemoryEvent[]): MemoryCompilation;
}
//# sourceMappingURL=memory-compiler.d.ts.map