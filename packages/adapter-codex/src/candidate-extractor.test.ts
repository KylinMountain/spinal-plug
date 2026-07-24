import assert from "node:assert/strict";
import test from "node:test";
import { extractCodexCandidates } from "./candidate-extractor.js";

test("extracts only bounded durable candidates from a Codex stop result", () => {
  const candidates = extractCodexCandidates({
    event: "stop",
    cwd: "/tmp/payments",
    sessionId: "session_a",
    output: [
      "决定采用双写迁移，因为商户不能停机。",
      "以后所有支付 Schema 变更必须保持新旧消费者兼容七天。",
      "发布窗口以 https://linear.example.test/ENG-42 为准。",
      "下一步修改 PaymentConsumer 并运行测试。"
    ].join("\n")
  });

  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map(candidate => candidate.kind), ["decision", "directive", "reference"]);
  assert.ok(candidates.every(candidate => candidate.confidence < 0.92));
  assert.ok(candidates.every(candidate => candidate.semanticKey?.startsWith(`${candidate.kind}:auto:`)));
  assert.ok(candidates.every(candidate => !candidate.statement.includes("下一步")));
});

test("rejects secrets, temporary progress, and non-stop input", () => {
  const payload = {
    cwd: "/tmp/payments",
    sessionId: "session_b",
    output: [
      "决定采用 Kafka，token=ABCD1234efgh5678。",
      "当前正在运行测试，下一步确认结果。",
      "普通回复，没有持久决策。"
    ].join("\n")
  };
  assert.deepEqual(extractCodexCandidates({ ...payload, event: "stop" }), []);
  assert.deepEqual(extractCodexCandidates({ ...payload, event: "prompt.submit" }), []);
});
