function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function readStringEnv(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getApiBaseUrl(): string {
  const fromEnv = readStringEnv(import.meta.env['WXT_API_BASE_URL']);
  if (fromEnv) return trimTrailingSlash(fromEnv);
  return 'http://localhost:8787';
}

export function getWebAppBaseUrl(): string {
  const fromEnv = readStringEnv(import.meta.env['WXT_WEB_APP_BASE_URL']);
  if (fromEnv) return trimTrailingSlash(fromEnv);
  return getApiBaseUrl();
}

export function buildWebAppUrl(path: string, params?: Record<string, string | null | undefined>): string {
  const baseUrl = getWebAppBaseUrl();
  const url = new URL(path, `${baseUrl}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}
