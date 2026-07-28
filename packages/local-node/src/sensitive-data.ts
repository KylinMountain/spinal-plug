import type { MemoryRecord } from "@spinal-plug/protocol";

const SECRET_VALUE = "[A-Za-z0-9][A-Za-z0-9_./+=-]{7,}";

const DIRECT_SECRET_PATTERNS = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bmpd_[A-Za-z0-9_-]{16,}\b/
];

const LABELLED_SECRET_PATTERN = new RegExp(
  String.raw`(?:api[_ -]?key|access[_ -]?token|auth(?:entication)?[_ -]?token|token|secret|password|passwd|private[_ -]?key|credential(?:s)?|密码|口令)\s*(?:[:=：])\s*["']?${SECRET_VALUE}["']?`,
  "i"
);

// "Authorization: Bearer <token>" is the single most common credential shape
// in logs and headers; the label needs no punctuation before the value.
const BEARER_TOKEN_PATTERN = new RegExp(
  String.raw`\bbearer\s+["']?${SECRET_VALUE}["']?`,
  "i"
);

// Verb ("is"/"为"/"是") and bare-whitespace separators only count when the
// value carries a digit or `_/+=-` — otherwise ordinary prose such as
// "password rotation" or "secret reference." would be refused. A trailing
// dot does not count: sentence punctuation is not credential material.
const VALUE_WITH_DIGIT_OR_SYMBOL = `(?=[A-Za-z0-9_./+=-]*(?:\\d|[_/+=-]))${SECRET_VALUE}`;

const VERB_LABELLED_SECRET_PATTERN = new RegExp(
  String.raw`(?:api[_ -]?key|access[_ -]?token|auth(?:entication)?[_ -]?token|token|secret|password|passwd|credential(?:s)?|密码|口令)\s*(?:is|为|是)\s*["']?${VALUE_WITH_DIGIT_OR_SYMBOL}["']?`,
  "i"
);

const SPACED_LABELLED_SECRET_PATTERN = new RegExp(
  String.raw`(?:api[_ -]?key|access[_ -]?token|auth(?:entication)?[_ -]?token|token|secret|password|passwd|credential(?:s)?)\s+["']?${VALUE_WITH_DIGIT_OR_SYMBOL}["']?`,
  "i"
);

// Chinese notes often write "密码 value" without punctuation. Keep this
// separate from English labels so ordinary phrases such as "password rotation"
// are not mistaken for credentials.
const CHINESE_LABELLED_SECRET_PATTERN = new RegExp(
  String.raw`(?:密码|口令)\s+(?:["']?${SECRET_VALUE}["']?)`,
  "i"
);

export function containsLikelySecret(value: string): boolean {
  return DIRECT_SECRET_PATTERNS.some(pattern => pattern.test(value))
    || LABELLED_SECRET_PATTERN.test(value)
    || BEARER_TOKEN_PATTERN.test(value)
    || VERB_LABELLED_SECRET_PATTERN.test(value)
    || SPACED_LABELLED_SECRET_PATTERN.test(value)
    || CHINESE_LABELLED_SECRET_PATTERN.test(value);
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
