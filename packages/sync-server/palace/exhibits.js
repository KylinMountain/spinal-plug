/**
 * Pure mapping from memory records to gallery exhibit specifications.
 * No three.js or DOM imports on purpose: this module is unit-tested in Node.
 */

export const KIND_GEOMETRY = {
  directive: { shape: "octahedron", detail: 0 },
  decision: { shape: "dodecahedron", detail: 0 },
  context: { shape: "icosahedron", detail: 0 },
  reference: { shape: "box", detail: 0 }
};

const FALLBACK_GEOMETRY = { shape: "tetrahedron", detail: 0 };

export const STATUS_STYLE = {
  active: {
    color: 0xffd9a0,
    emissive: 0xffb35c,
    emissiveIntensity: 0.55,
    opacity: 1,
    transparent: false,
    glow: 0xffc069,
    motion: { type: "steady", speed: 0, min: 1, max: 1 }
  },
  candidate: {
    color: 0xffb84d,
    emissive: 0xd98a1f,
    emissiveIntensity: 0.45,
    opacity: 0.92,
    transparent: true,
    glow: 0xffa63d,
    motion: { type: "breath", speed: 0.6, min: 0.3, max: 1 }
  },
  disputed: {
    color: 0xff5544,
    emissive: 0xc2251b,
    emissiveIntensity: 0.7,
    opacity: 1,
    transparent: false,
    glow: 0xff4433,
    motion: { type: "pulse", speed: 2.4, min: 0.2, max: 1 }
  },
  deleted: {
    color: 0x8f97a3,
    emissive: 0x2c3440,
    emissiveIntensity: 0.25,
    opacity: 0.22,
    transparent: true,
    glow: 0x55606e,
    motion: { type: "ghost", speed: 0.4, min: 0.5, max: 0.9 }
  },
  superseded: {
    color: 0xb8a98a,
    emissive: 0x5c5138,
    emissiveIntensity: 0.2,
    opacity: 0.45,
    transparent: true,
    glow: 0x7a6f52,
    motion: { type: "ghost", speed: 0.3, min: 0.7, max: 1 }
  }
};

const FALLBACK_STATUS = STATUS_STYLE.active;

const PEDESTAL = {
  color: 0x4a4238,
  height: 1.15,
  radius: 0.55
};

export function geometryForKind(kind) {
  return KIND_GEOMETRY[kind] ?? FALLBACK_GEOMETRY;
}

export function styleForStatus(status) {
  return STATUS_STYLE[status] ?? FALLBACK_STATUS;
}

/** Confidence in [0, 1] scales the artifact between 0.55x and 1.05x. */
export function artifactScale(memory) {
  const confidence = typeof memory?.confidence === "number" ? memory.confidence : 0.5;
  const clamped = Math.min(Math.max(confidence, 0), 1);
  return 0.55 + clamped * 0.5;
}

/**
 * Full exhibit specification for one memory record: pedestal plus the
 * floating artifact above it. `hoverHeight` is the artifact center height
 * above the floor; `spinSpeed` is radians per second.
 */
export function exhibitSpec(memory) {
  const style = styleForStatus(memory?.status);
  return {
    memoryId: memory?.memoryId ?? "",
    kind: memory?.kind ?? "unknown",
    status: memory?.status ?? "active",
    geometry: geometryForKind(memory?.kind),
    style,
    scale: artifactScale(memory),
    pedestal: { ...PEDESTAL },
    hoverHeight: PEDESTAL.height + 0.85,
    floatAmplitude: 0.08,
    spinSpeed: memory?.status === "deleted" ? 0.05 : 0.35
  };
}

/**
 * Evenly spaced ring positions for `count` exhibits around the hall center.
 * Returns [{ x, z, angle }] with the first exhibit at angle 0.
 */
export function layoutPositions(count, radius = 10) {
  const positions = [];
  const n = Math.max(0, Math.floor(count));
  for (let index = 0; index < n; index += 1) {
    const angle = (index / n) * Math.PI * 2;
    positions.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle });
  }
  return positions;
}

/**
 * Diff two snapshots by memory id: returns ids that are new or whose status
 * changed, so the UI can highlight them with fly-in light dust.
 */
export function diffMemories(previous, next) {
  const before = new Map((previous ?? []).map(memory => [memory.memoryId, memory.status]));
  const added = [];
  const statusChanged = [];
  for (const memory of next ?? []) {
    if (!before.has(memory.memoryId)) {
      added.push(memory.memoryId);
    } else if (before.get(memory.memoryId) !== memory.status) {
      statusChanged.push(memory.memoryId);
    }
  }
  return { added, statusChanged };
}
