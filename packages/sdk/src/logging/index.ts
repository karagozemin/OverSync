export function redactLogValue(val: any): any {
  if (typeof val === 'string') {
    return redactLogString(val);
  }
  if (val instanceof Error) {
    return { message: redactLogString(val.message) };
  }
  return val;
}

export function redactLogString(line: string): string {
  // Redact Bearer tokens
  line = line.replace(/Bearer [A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, 'Bearer [REDACTED]');
  // Redact 64-byte hex (eth private keys)
  line = line.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED]');
  // Redact Stellar secrets
  line = line.replace(/S[A-Z2-7]{55}/g, '[REDACTED]');
  return line;
}

export function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  return normalized.includes('secret') || normalized.includes('privatekey') || normalized.includes('signedxdr');
}
