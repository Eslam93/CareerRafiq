import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { SESSION_COOKIE_NAME, getAllowedCorsOrigins, getCookieSameSiteMode, shouldUseSecureCookies } from './config.js';
import { CLIENT_SURFACE_HEADER, EYE_SESSION_HEADER, REQUEST_ID_HEADER } from './request-context.js';

export const CSRF_COOKIE_NAME = 'career_rafiq_csrf';
export const CSRF_HEADER_NAME = 'x-careerrafiq-csrf';

export async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload, null, 2));
}

export function sendNoContent(response: ServerResponse, statusCode = 204): void {
  response.statusCode = statusCode;
  response.end();
}

export function parseRequestCookies(request: IncomingMessage): Record<string, string | undefined> {
  return parseCookie(request.headers.cookie ?? '');
}

function appendSetCookie(response: ServerResponse, value: string): void {
  const existing = response.getHeader('set-cookie');
  if (!existing) {
    response.setHeader('set-cookie', value);
    return;
  }
  if (Array.isArray(existing)) {
    response.setHeader('set-cookie', [...existing, value]);
    return;
  }
  response.setHeader('set-cookie', [String(existing), value]);
}

function buildCookieOptions(maxAge?: number) {
  const secure = shouldUseSecureCookies();
  return {
    path: '/',
    sameSite: getCookieSameSiteMode(),
    secure,
    ...(typeof maxAge === 'number' ? { maxAge } : {}),
  };
}

export function setSessionCookie(response: ServerResponse, token: string, expiresAt?: string | null): void {
  const maxAge = expiresAt
    ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    : 60 * 60 * 24 * 30;
  appendSetCookie(
    response,
    serializeCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      ...buildCookieOptions(maxAge),
    }),
  );
}

export function clearSessionCookie(response: ServerResponse): void {
  appendSetCookie(
    response,
    serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      ...buildCookieOptions(0),
    }),
  );
}

export function setCsrfCookie(response: ServerResponse, token: string, maxAge = 60 * 60 * 24 * 30): void {
  appendSetCookie(
    response,
    serializeCookie(CSRF_COOKIE_NAME, token, buildCookieOptions(maxAge)),
  );
}

export function issueFreshCsrfCookie(response: ServerResponse): string {
  const token = randomBytes(24).toString('hex');
  setCsrfCookie(response, token);
  return token;
}

export function ensureCsrfCookie(request: IncomingMessage, response: ServerResponse): string {
  const existingToken = parseRequestCookies(request)[CSRF_COOKIE_NAME];
  if (existingToken) {
    return existingToken;
  }
  return issueFreshCsrfCookie(response);
}

export function clearCsrfCookie(response: ServerResponse): void {
  appendSetCookie(
    response,
    serializeCookie(CSRF_COOKIE_NAME, '', buildCookieOptions(0)),
  );
}

export function getSessionTokenFromRequest(request: IncomingMessage): string | null {
  return parseRequestCookies(request)[SESSION_COOKIE_NAME] ?? null;
}

export function hasValidCsrfToken(request: IncomingMessage): boolean {
  const cookies = parseRequestCookies(request);
  const cookieToken = cookies[CSRF_COOKIE_NAME] ?? null;
  const headerValue = request.headers[CSRF_HEADER_NAME];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] ?? null : headerValue ?? null;
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

export function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  const allowedOrigins = getAllowedCorsOrigins();
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-credentials', 'true');
    response.setHeader('access-control-allow-headers', `content-type,${CSRF_HEADER_NAME},${EYE_SESSION_HEADER},${CLIENT_SURFACE_HEADER}`);
    response.setHeader('access-control-expose-headers', REQUEST_ID_HEADER);
    response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  }
  if (request.method === 'OPTIONS') {
    sendNoContent(response);
    return true;
  }
  return false;
}

export function isAllowedRequestOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  return getAllowedCorsOrigins().includes(origin);
}
