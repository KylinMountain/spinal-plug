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

/**
 * Identifier prefixes this system mints itself. They are high-entropy on
 * purpose and appear throughout ordinary memory — a Space id, a memory id, a
 * handoff id — so the entropy rule below must never read one as a credential.
 */
const KNOWN_ID_PREFIX = /^(?:mem|spc|evt|hnd|dsp|cur|job|extract|upd|dev|acc|persona)[_-]/i;

function shannonEntropyPerChar(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

/**
 * Catches an unlabelled key pasted on its own — the shape no vendor pattern and
 * no label can find.
 *
 * The bar is deliberately narrow, because the alternative is refusing the user's
 * own memory: this project's ids, Git SHAs and UUIDs are all long and random. A
 * token must mix upper case, lower case and digits (which excludes every
 * hex-only SHA and every UUID), be long enough to be a key rather than a word,
 * carry real entropy, and not be an identifier this system minted.
 */
const HIGH_ENTROPY_MIN_LENGTH = 32;
const HIGH_ENTROPY_MIN_BITS_PER_CHAR = 3.6;

function containsHighEntropyToken(value: string): boolean {
  // `/` separates tokens rather than joining them. Keeping it would read a URL
  // path — `github.com/KylinMountain/spinal-plug/pull/14` — as one long
  // mixed-case token, and refusing a memory that merely cites a link is worse
  // than missing the one shape this costs: an unlabelled base64 key whose random
  // bytes happen to include a slash. That shape is still caught when it carries a
  // label or sits in a URL.
  for (const token of value.split(/[^A-Za-z0-9+=_-]+/)) {
    if (token.length < HIGH_ENTROPY_MIN_LENGTH) continue;
    if (KNOWN_ID_PREFIX.test(token)) continue;
    if (!/[a-z]/.test(token) || !/[A-Z]/.test(token) || !/\d/.test(token)) continue;
    if (shannonEntropyPerChar(token) >= HIGH_ENTROPY_MIN_BITS_PER_CHAR) return true;
  }
  return false;
}

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

export function containsLikelySecret(value: string): boolean {
  return DIRECT_SECRET_PATTERNS.some(pattern => pattern.test(value))
    || CREDENTIAL_URL_PATTERN.test(value)
    || LABELLED_SECRET_PATTERN.test(value)
    || BEARER_TOKEN_PATTERN.test(value)
    || VERB_LABELLED_SECRET_PATTERN.test(value)
    || SPACED_LABELLED_SECRET_PATTERN.test(value)
    || containsHighEntropyToken(value);
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
