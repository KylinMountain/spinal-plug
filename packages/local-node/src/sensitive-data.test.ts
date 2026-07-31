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
  assert.equal(containsLikelySecret("private_key: abcd1234efgh5678"), true);
});

test("bearer tokens and whitespace-separated labels are detected", () => {
  // Regression: unifying the patterns dropped most of these shapes even
  // though the old Codex extractor caught them.
  assert.equal(containsLikelySecret("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"), true);
  assert.equal(containsLikelySecret("bearer abcdef123456789"), true);
  assert.equal(containsLikelySecret("password hunter2hunter2"), true);
  assert.equal(containsLikelySecret("api_key abcdefgh12345"), true);
  assert.equal(containsLikelySecret("private key hunter2hunter2"), true);
  assert.equal(containsLikelySecret("密码是local-test-credential-20260728"), true);
  assert.equal(containsLikelySecret("密码 local-test-credential-20260728"), true);
  assert.equal(containsLikelySecret("token is abc12345xyz"), true);
});

test("ordinary prose near secret labels is not refused", () => {
  assert.equal(containsLikelySecret("password rotation happens monthly"), false);
  assert.equal(containsLikelySecret("口令 rotation happens monthly"), false);
  assert.equal(containsLikelySecret("密码 requirement is 12 chars"), false);
  assert.equal(containsLikelySecret("token is required for this call"), false);
  assert.equal(containsLikelySecret("token: required for this call"), false);
  assert.equal(containsLikelySecret("Access token: required before deploy"), false);
  assert.equal(containsLikelySecret("token 2026-07-28 rotate quarterly"), false);
  assert.equal(containsLikelySecret("bearer of good news"), false);
  assert.equal(containsLikelySecret("the credentialing process"), false);
  assert.equal(containsLikelySecret("The staging environment uses a managed secret reference."), false);
  assert.equal(containsLikelySecret("Use pnpm as the only package manager."), false);
});

/**
 * Vendor fixtures are assembled at run time instead of written as literals. A
 * realistic-looking key in a source file trips GitHub's push protection, which
 * has no way to know it is synthetic — and the value under test is identical
 * either way. The alternative, whitelisting "secrets" on the repository, would
 * weaken a real protection to keep a test convenient.
 */
const VENDOR_KEY_FIXTURES = [
  ["sk", "live", "51H8xk2LkdIwHu7ixX9nSTRIPEKEY0000"].join("_"),
  ["sk", "test", "51H8xk2LkdIwHu7ixX9nSTRIPEKEY0000"].join("_"),
  ["rk", "live", "51H8xk2LkdIwHu7ixX9nRESTRICT0000"].join("_"),
  ["glpat", "ABCdef123456789012345"].join("-"),
  ["npm", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_"),
  ["hf", "ABCdefghijklmnopqrstuvwxyz01234567"].join("_"),
  ["AIza", "SyC0123456789", "abcdefghijklmnopqrstuv"].join(""),
  ["SG", "abcdefghij0123456", "klmnopqrstuvwxyz0123456789"].join("."),
  "AC" + "0123456789abcdef".repeat(2)
];

test("vendor key shapes that carry no label are detected", () => {
  // The `sk-` rule never covered the underscore-separated prefixes, so a Stripe
  // key pasted on its own read as ordinary text.
  for (const value of VENDOR_KEY_FIXTURES) {
    assert.equal(containsLikelySecret(value), true, value.slice(0, 12));
  }
});

test("a JWT is refused even though its payload is readable", () => {
  assert.equal(
    containsLikelySecret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    true
  );
});

test("a URL carrying inline credentials is refused, an ordinary URL is not", () => {
  for (const value of [
    "postgres://admin:h7Kd93ncMs@db.internal:5432/app",
    "mongodb+srv://root:Zx91kdlSm2@cluster0.mongodb.net",
    "redis://:s3cr3tPassw0rd@10.0.0.4:6379",
    "amqp://svc:Q9kdmz01ss@broker:5672"
  ]) {
    assert.equal(containsLikelySecret(value), true, value.slice(0, 16));
  }

  for (const value of [
    "see https://github.com/KylinMountain/spinal-plug/pull/14",
    "endpoint http://127.0.0.1:8787 stays local",
    "origin is git@github.com:KylinMountain/spinal-plug.git",
    "postgres://db.internal:5432/app needs no password here"
  ]) {
    assert.equal(containsLikelySecret(value), false, value.slice(0, 16));
  }
});

test("AWS_SECRET_ACCESS_KEY is recognised as a label", () => {
  // "secret" was in the label list but never sat immediately before the
  // separator, so the most common credential variable there is went unmatched.
  assert.equal(containsLikelySecret("AWS_SECRET_ACCESS_KEY=abcd1234efgh5678"), true);
  assert.equal(containsLikelySecret("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"), true);
  assert.equal(containsLikelySecret("the access key rotation policy is quarterly"), false);
  assert.equal(containsLikelySecret("an access key is required before deploy"), false);
});

test("random text that is not a credential is not refused", () => {
  // An entropy heuristic was tried here and removed. These four are what killed
  // it: the last two are word-structured and could have been excluded, but a
  // Drive id and a package digest are *actually* random, so no threshold
  // separates them from a key. Since `list` filters stored records through this
  // function, a false positive silently removes a memory from recall, boot and
  // every host projection — worse than missing an unlabelled key. Anyone adding
  // an entropy rule has to keep these passing.
  for (const value of [
    "See https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
    "integrity sha512-7X9Kk3Vb2dQwZzT1mLpQrs8AbCdEfGh0iJkLmNoPqRs=",
    "renamed to previewCanonicalUpdatesForSpace2026",
    "Base branch: feature/AddSupportForMultiTenantWorkspaces2026Rollout"
  ]) {
    assert.equal(containsLikelySecret(value), false, value.slice(0, 32));
  }
});

test("this system's own identifiers are never read as credentials", () => {
  // The entropy rule would otherwise refuse the project's own memory: Space
  // ids, memory ids, handoffs, Git SHAs and paths are all long and random.
  for (const value of [
    "两仓策略见 spc_git_fd4a9ae0d473ca5ce2d7e9bb4492dd87",
    "mem_a0250ddd-b606-42a1-985a-05c8529f0ab2 是那条决策",
    "hnd_dd5bb871-a4d5-4cb2-83e8-d6ab8190fc51",
    "evt_43ae123d-eb16-4850-812b-ed5982d998c5",
    "fixed in 64fea8c9a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "session 550e8400-e29b-41d4-a716-446655440000",
    "pin actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "~/.claude/projects/-Users-evilkylin-Projects-Spinal-Plug/memory/spinal-plug-synced.md",
    "ClaudeAutoMemoryMaterializerProjectionRefresh"
  ]) {
    assert.equal(containsLikelySecret(value), false, value.slice(0, 24));
  }
});
