import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { containsLikelySecret } from "./sensitive-data.js";

test("labelled secrets with punctuation separators are detected", () => {
  assert.equal(containsLikelySecret("api_key = abcdefgh12345"), true);
  assert.equal(containsLikelySecret("token: gh_abcdef123456"), true);
  assert.equal(containsLikelySecret("密码:local-test-credential-20260728"), true);
});

test("bearer tokens and whitespace-separated labels are detected", () => {
  // Regression: unifying the patterns dropped these shapes even though the
  // old Codex extractor caught them.
  assert.equal(containsLikelySecret("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"), true);
  assert.equal(containsLikelySecret("bearer abcdef123456789"), true);
  assert.equal(containsLikelySecret("password hunter2hunter2"), true);
  assert.equal(containsLikelySecret("api_key abcdefgh12345"), true);
  assert.equal(containsLikelySecret("密码是local-test-credential-20260728"), true);
  assert.equal(containsLikelySecret("token is abc12345xyz"), true);
});

test("ordinary prose near secret labels is not refused", () => {
  assert.equal(containsLikelySecret("password rotation happens monthly"), false);
  assert.equal(containsLikelySecret("token is required for this call"), false);
  assert.equal(containsLikelySecret("bearer of good news"), false);
  assert.equal(containsLikelySecret("the credentialing process"), false);
  assert.equal(containsLikelySecret("The staging environment uses a managed secret reference."), false);
  assert.equal(containsLikelySecret("Use pnpm as the only package manager."), false);
});
