const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "mnemonic",
  "preimage",
  "privatekey",
  "resolverprivatekey",
  "resolversecret",
  "secret",
  "secretkey",
  "signedxdr",
  "token"
]);

function normaliseKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normaliseKey(key));
}

export function redactLogString(value: string): string {
  return value
    .replace(/\bBearer\s+[-._~+/A-Za-z0-9]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\b0x[0-9a-fA-F]{64,}\b/g, REDACTED)
    .replace(/\bS[A-Z2-7]{55}\b/g, REDACTED);
}

export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactLogString(value);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogString(value.message),
      stack: value.stack ? redactLogString(value.stack) : undefined
    };
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = isSensitiveLogKey(key) ? REDACTED : redactLogValue(nested, seen);
  }
  return redacted;
}

export function redactLogObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return redactLogValue(value) as Record<string, unknown>;
}
