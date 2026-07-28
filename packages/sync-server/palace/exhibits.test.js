import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactScale,
  diffMemories,
  exhibitSpec,
  geometryForKind,
  layoutPositions,
  styleForStatus
} from "./exhibits.js";

test("maps every memory kind to a distinct geometry", () => {
  assert.equal(geometryForKind("directive").shape, "octahedron");
  assert.equal(geometryForKind("decision").shape, "dodecahedron");
  assert.equal(geometryForKind("context").shape, "icosahedron");
  assert.equal(geometryForKind("reference").shape, "box");
  assert.equal(geometryForKind("mystery").shape, "tetrahedron");
});

test("maps every memory status to its light treatment", () => {
  assert.equal(styleForStatus("active").motion.type, "steady");
  assert.equal(styleForStatus("candidate").motion.type, "breath");
  assert.equal(styleForStatus("disputed").motion.type, "pulse");
  assert.equal(styleForStatus("deleted").motion.type, "ghost");
  assert.ok(styleForStatus("deleted").transparent);
  assert.ok(styleForStatus("deleted").opacity < 0.5);
  assert.equal(styleForStatus("unknown"), styleForStatus("active"));
});

test("artifact scale follows confidence within bounds", () => {
  assert.equal(artifactScale({ confidence: 0 }), 0.55);
  assert.equal(artifactScale({ confidence: 1 }), 1.05);
  assert.equal(artifactScale({}), 0.8);
  assert.equal(artifactScale({ confidence: 42 }), 1.05);
});

test("exhibit spec combines kind geometry and status style", () => {
  const spec = exhibitSpec({ memoryId: "mem_1", kind: "decision", status: "disputed", confidence: 0.95 });
  assert.equal(spec.geometry.shape, "dodecahedron");
  assert.equal(spec.style.motion.type, "pulse");
  assert.ok(spec.scale > 1);
  assert.ok(spec.pedestal.height > 0);
  assert.ok(spec.hoverHeight > spec.pedestal.height);
});

test("layout positions form an evenly spaced ring", () => {
  const positions = layoutPositions(4, 10);
  assert.equal(positions.length, 4);
  for (const { x, z } of positions) {
    assert.ok(Math.abs(Math.hypot(x, z) - 10) < 1e-9);
  }
  assert.deepEqual(layoutPositions(0), []);
});

test("diffMemories reports additions and status changes only", () => {
  const previous = [
    { memoryId: "a", status: "candidate" },
    { memoryId: "b", status: "active" }
  ];
  const next = [
    { memoryId: "a", status: "active" },
    { memoryId: "b", status: "active" },
    { memoryId: "c", status: "candidate" }
  ];
  assert.deepEqual(diffMemories(previous, next), { added: ["c"], statusChanged: ["a"] });
  assert.deepEqual(diffMemories(null, null), { added: [], statusChanged: [] });
});
