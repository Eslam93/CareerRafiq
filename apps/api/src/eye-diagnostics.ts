const SECRET_KEY_PATTERN = /(authorization|cookie|token|password|secret|api[-_]?key|smtp)/i;

function redactStringValue(key: string, value: string): string {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  return value;
}

export function redactDiagnosticPayload(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticPayload(entry, key));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return redactStringValue(key, value);
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([entryKey, entryValue]) => {
      if (SECRET_KEY_PATTERN.test(entryKey)) {
        return [entryKey, '[REDACTED]'];
      }
      return [entryKey, redactDiagnosticPayload(entryValue, entryKey)];
    }),
  );
}

export function sanitizeRequestHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return redactDiagnosticPayload(headers) as Record<string, unknown>;
}

export function summarizeObjectDiff(beforeValue: Record<string, unknown>, afterValue: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)]);
  return [...keys]
    .filter((key) => JSON.stringify(beforeValue[key]) !== JSON.stringify(afterValue[key]))
    .sort((left, right) => left.localeCompare(right));
}
