import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SpinalPlugDatabase } from "./index.js";

function openTestDatabase(): SpinalPlugDatabase {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-extraction-"));
  const database = new SpinalPlugDatabase(join(directory, "local.db"));
  database.init();
  return database;
}

function enqueue(database: SpinalPlugDatabase, jobId = "job_1"): boolean {
  return database.enqueueCandidateExtraction({
    jobId,
    host: "codex",
    spaceId: "spc_extract",
    sessionId: "session_1",
    sourceDigest: "a".repeat(64),
    candidates: [{
      kind: "decision",
      title: "Use dual writes",
      statement: "Use dual writes during payment migration.",
      semanticKey: "decision:auto:dual-write",
      confidence: 0.74
    }],
    createdAt: "2026-07-24T00:00:00.000Z"
  });
}

test("candidate extraction queue deduplicates and completes without raw turn storage", () => {
  const database = openTestDatabase();
  assert.equal(enqueue(database), true);
  assert.equal(enqueue(database), false);

  const job = database.claimCandidateExtraction("spc_extract", new Date("2026-07-24T00:00:01.000Z"));
  assert.ok(job);
  assert.equal(job.status, "processing");
  assert.equal(job.candidates[0].statement, "Use dual writes during payment migration.");
  assert.equal(database.completeCandidateExtraction(job.jobId, "2026-07-24T00:00:02.000Z"), true);
  assert.equal(database.listCandidateExtractionJobs("spc_extract")[0].status, "completed");
});

test("expired extraction leases are reclaimed for retry", () => {
  const database = openTestDatabase();
  enqueue(database);
  const first = database.claimCandidateExtraction("spc_extract", new Date("2026-07-24T00:00:00.000Z"), 1_000);
  assert.ok(first);
  const recovered = database.claimCandidateExtraction("spc_extract", new Date("2026-07-24T00:00:02.000Z"));
  assert.ok(recovered);
  assert.equal(recovered.jobId, first.jobId);
  assert.equal(recovered.attempts, 2);
});
