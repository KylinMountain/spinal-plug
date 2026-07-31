import type { MemoryRecord } from "@spinal-plug/protocol";

const SECRET_VALUE = "[A-Za-z0-9][A-Za-z0-9_./+=-]{7,}";

const DIRECT_SECRET_PATTERNS = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bmpd_[A-Za-z0-9_-]{16,}\b/,
  // Underscore-separated vendor prefixes. The `sk-` rule above never covered
  // them, so a Stripe key read as ordinary text.
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bhf_[A-Za-z0-9]{34,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  /\b(?:AC|SK)[0-9a-fA-F]{32}\b/,
  // A JWT always begins with the base64 of `{"`, and its three segments make it
  // unmistakable — the payload is readable, so it leaks more than it authorizes.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
];

// A URL carrying inline credentials: scheme://[user]:password@host. Requiring
// both the colon and the `@`, and forbidding `/` inside either field, keeps
// ordinary URLs and `git@host` out of it.
const CREDENTIAL_URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:[^\s@/]{4,}@/i;

// One label table shared by every separated form, so a label cannot leak
// through a separator variant (private key nearly did).
// `access[_ -]?key` covers AWS_SECRET_ACCESS_KEY, the most common credential
// variable there is: "secret" sat in the list but never immediately before the
// separator, so the whole label went unrecognised.
const SECRET_LABEL = String.raw`(?:api[_ -]?key|access[_ -]?key|access[_ -]?token|auth(?:entication)?[_ -]?token|token|secret|password|passwd|private[_ -]?key|credential(?:s)?|密码|口令)`;

// Every separated form requires the value to carry a digit or `_/+=-` —
// otherwise ordinary prose ("password rotation", "token: required",
// "口令 requirement") would be refused. A trailing dot does not count, and
// date-shaped values are explicitly not credential material.
const GATED_SECRET_VALUE = String.raw`(?!\d{4}[-./]\d{1,2}[-./]\d{1,2}\b)(?=[A-Za-z0-9_./+=-]*(?:\d|[_/+=-]))${SECRET_VALUE}`;

const LABELLED_SECRET_PATTERN = new RegExp(
  String.raw`${SECRET_LABEL}\s*[:=：]\s*["']?${GATED_SECRET_VALUE}["']?`,
  "i"
);

// "Authorization: Bearer <token>" is the single most common credential shape
// in logs and headers; the label needs no punctuation before the value.
const BEARER_TOKEN_PATTERN = new RegExp(
  String.raw`\bbearer\s+["']?${SECRET_VALUE}["']?`,
  "i"
);

const VERB_LABELLED_SECRET_PATTERN = new RegExp(
  String.raw`${SECRET_LABEL}\s*(?:is|为|是)\s*["']?${GATED_SECRET_VALUE}["']?`,
  "i"
);

const SPACED_LABELLED_SECRET_PATTERN = new RegExp(
  String.raw`${SECRET_LABEL}\s+["']?${GATED_SECRET_VALUE}["']?`,
  "i"
);

/*
 * No entropy heuristic lives here, and that is deliberate. One was tried: a
 * bare token had to mix case and digits, clear an entropy bar, and not be an
 * identifier this system mints. It still flagged a Google Docs link, an npm
 * `sha512-` integrity string and `feature/AddSupportForMultiTenantWorkspaces`
 * — and the first two are indistinguishable from a real key by entropy at any
 * threshold, because they *are* random.
 *
 * The cost of a false positive here is not a warning. `list` filters stored
 * records through this function, so a memory that merely cites a Drive link
 * disappears from recall, boot and every host projection without a word; the
 * publish path marks an event it will not send as delivered. Refusing the
 * user's own memory is worse than missing an unlabelled key, so detection stays
 * on shapes that identify themselves: vendor prefixes, JWTs, credential URLs
 * and labelled assignments. Re-adding an entropy rule means solving the doc-link
 * and digest cases first — the tests below stand guard.
 */

export function containsLikelySecret(value: string): boolean {
  return DIRECT_SECRET_PATTERNS.some(pattern => pattern.test(value))
    || CREDENTIAL_URL_PATTERN.test(value)
    || LABELLED_SECRET_PATTERN.test(value)
    || BEARER_TOKEN_PATTERN.test(value)
    || VERB_LABELLED_SECRET_PATTERN.test(value)
    || SPACED_LABELLED_SECRET_PATTERN.test(value);
}

/** Error code carried by write-time secret rejections, so permanent validation failures are identifiable without matching message text. */
export class SecretMaterialError extends Error {
  readonly code = "secret_material" as const;
  constructor(message: string) {
    super(message);
    this.name = "SecretMaterialError";
  }
}

export function memoryContainsLikelySecret(memory: Pick<MemoryRecord, "title" | "statement" | "why" | "howToApply" | "references">): boolean {
  return [
    memory.title,
    memory.statement,
    memory.why,
    memory.howToApply,
    ...memory.references
  ].filter((value): value is string => Boolean(value)).some(containsLikelySecret);
}

/** Reject secret-shaped strings anywhere in a durable object before it is persisted or projected. */
export function valueContainsLikelySecret(value: unknown): boolean {
  const seen = new Set<object>();
  const inspect = (candidate: unknown): boolean => {
    if (typeof candidate === "string") return containsLikelySecret(candidate);
    if (!candidate || typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(inspect);
    return Object.entries(candidate).some(([key, entry]) => {
      if (typeof entry === "string" && containsLikelySecret(`${key}: ${entry}`)) return true;
      return inspect(entry);
    });
  };
  return inspect(value);
}
