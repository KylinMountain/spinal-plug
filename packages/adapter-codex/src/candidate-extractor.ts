import { createHash } from "node:crypto";
import type { AdapterObservation, HostHookPayload } from "@mind-palace/adapter-sdk";

const SECRET_PATTERN = /(?:api[_-]?key|access[_-]?token|token|secret|password|private[_ -]?key|bearer\s+)[=:"'\s]*[A-Za-z0-9_\-/.+=]{8,}/i;
const EPHEMERAL_PATTERN = /(?:\btodo\b|\bnext\s+(?:step|action)\b|\bworking on\b|\brunning tests?\b|\bcurrently\b|下一步|正在|待处理|临时|本轮)/i;
const DECISION_PATTERN = /(?:决定(?:采用|使用|选择)|确定(?:采用|使用|选择)|改为|统一使用|采用|选择|will use|we(?:'ll| will) use|decided to use|choose|instead of)/i;
const DIRECTIVE_PATTERN = /(?:以后|始终|一律|必须|不要|禁止|请务必|always|never|must|do not|don't)/i;
const CONTEXT_PATTERN = /(?:业务(?:要求|约束)|客户(?:要求|约束)|兼容(?:性|期)|不能停机|无法(?:接受|使用)|合规|deadline|发布窗口|必须支持)/i;
const URL_PATTERN = /https?:\/\/[^\s)>\]}]+/g;

function normalise(value: string): string {
  return value.replace(/[`*_>#]/g, "").replace(/\s+/g, " ").trim();
}

function sentences(value: string): string[] {
  return value
    .split(/(?:\r?\n)+|(?<=[。！？.!?])\s+/u)
    .map(normalise)
    .filter(sentence => sentence.length >= 12 && sentence.length <= 320);
}

function semanticKey(kind: AdapterObservation["kind"], statement: string): string {
  const digest = createHash("sha256").update(statement.toLocaleLowerCase()).digest("hex").slice(0, 16);
  return `${kind}:auto:${digest}`;
}

function candidate(
  kind: AdapterObservation["kind"],
  statement: string,
  source: AdapterObservation["source"],
  confidence: number,
  references: string[] = []
): AdapterObservation {
  return {
    kind,
    title: statement.slice(0, 80),
    statement,
    references,
    semanticKey: semanticKey(kind, statement),
    confidence,
    source
  };
}

/**
 * Conservative local extraction for Codex Stop hooks. It intentionally accepts
 * only durable-looking declarations and never persists the source turn.
 */
export function extractCodexCandidates(payload: HostHookPayload): AdapterObservation[] {
  if (payload.event !== "stop" || !payload.output) return [];

  const observations: AdapterObservation[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences(payload.output)) {
    if (SECRET_PATTERN.test(sentence) || EPHEMERAL_PATTERN.test(sentence)) continue;
    const references = sentence.match(URL_PATTERN) ?? [];
    let kind: AdapterObservation["kind"] | null = null;
    let confidence = 0;
    if (references.length > 0) {
      kind = "reference";
      confidence = 0.7;
    } else if (DECISION_PATTERN.test(sentence)) {
      kind = "decision";
      confidence = 0.74;
    } else if (DIRECTIVE_PATTERN.test(sentence)) {
      kind = "directive";
      confidence = 0.7;
    } else if (CONTEXT_PATTERN.test(sentence)) {
      kind = "context";
      confidence = 0.66;
    }
    if (!kind) continue;
    const key = `${kind}:${sentence.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    observations.push(candidate(kind, sentence, "stop", confidence, references));
    if (observations.length === 3) break;
  }
  return observations;
}
