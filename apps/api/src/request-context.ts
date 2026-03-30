import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientSurface } from '@career-rafiq/contracts';
import { createId } from '@career-rafiq/core';

export const REQUEST_ID_HEADER = 'x-careerrafiq-request-id';
export const EYE_SESSION_HEADER = 'x-careerrafiq-eye-session-id';
export const CLIENT_SURFACE_HEADER = 'x-careerrafiq-client-surface';

export interface RequestDiagnosticContext {
  requestId: string;
  eyeSessionId: string | null;
  clientSurface: ClientSurface;
  method: string;
  routePath: string;
  origin: string | null;
  startedAt: string;
  userId: string | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestDiagnosticContext>();

export function createRequestDiagnosticContext(input: {
  method: string;
  routePath: string;
  origin?: string | null;
  eyeSessionId?: string | null;
  clientSurface?: ClientSurface;
  startedAt?: string;
}): RequestDiagnosticContext {
  return {
    requestId: createId('req'),
    eyeSessionId: input.eyeSessionId ?? null,
    clientSurface: input.clientSurface ?? 'unknown',
    method: input.method,
    routePath: input.routePath,
    origin: input.origin ?? null,
    startedAt: input.startedAt ?? new Date().toISOString(),
    userId: null,
  };
}

export function runWithRequestDiagnosticContext<T>(
  context: RequestDiagnosticContext,
  callback: () => Promise<T> | T,
): Promise<T> | T {
  return requestContextStorage.run(context, callback);
}

export function getRequestDiagnosticContext(): RequestDiagnosticContext | null {
  return requestContextStorage.getStore() ?? null;
}

export function updateRequestDiagnosticContext(patch: Partial<RequestDiagnosticContext>): RequestDiagnosticContext | null {
  const current = requestContextStorage.getStore();
  if (!current) {
    return null;
  }
  Object.assign(current, patch);
  return current;
}

export function parseClientSurfaceHeader(value: string | string[] | undefined): ClientSurface {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'web' || raw === 'extension' || raw === 'server') {
    return raw;
  }
  return 'unknown';
}
