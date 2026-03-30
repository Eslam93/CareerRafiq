export interface LogFields {
  [key: string]: unknown;
}

function emit(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
    return;
  }
  if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
    return;
  }
  // eslint-disable-next-line no-console
  console.info(line);
}

export function logInfo(event: string, fields?: LogFields): void {
  emit('info', event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  emit('warn', event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  emit('error', event, fields);
}
