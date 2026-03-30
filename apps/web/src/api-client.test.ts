import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebApiClient, WebApiError, setStoredEyeSessionId } from './api-client.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (typeof originalWindow === 'undefined') {
    Reflect.deleteProperty(globalThis, 'window');
  } else {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }
});

describe('WebApiClient', () => {
  it('binds the default global fetch implementation so browser calls do not throw illegal invocation errors', async () => {
    const fetchMock = vi.fn(function (this: unknown, input: string | URL, init?: RequestInit) {
      expect(this).toBe(globalThis);
      expect(String(input)).toBe('/api/auth/session');
      expect(init?.credentials).toBe('include');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            authenticated: false,
            accessLevel: 'anonymous',
            user: null,
            sessionExpiresAt: null,
            returnAccessRequiresVerification: false,
            emailCollectionRequired: false,
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
          },
        ),
      );
    }) as typeof fetch;

    globalThis.fetch = fetchMock;

    const client = new WebApiClient();
    const session = await client.getSession();

    expect(session.authenticated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('attaches Eye headers on GET requests and preserves request ids on API errors', async () => {
    const localStorage = {
      getItem: vi.fn(() => 'eye_test_123'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage },
      configurable: true,
      writable: true,
    });
    setStoredEyeSessionId('eye_test_123');

    globalThis.fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        'x-careerrafiq-client-surface': 'web',
        'x-careerrafiq-eye-session-id': 'eye_test_123',
      });
      return new Response(
        JSON.stringify({
          error: 'Operator access is required for Eye diagnostics.',
          requestId: 'req_test_456',
        }),
        {
          status: 403,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-careerrafiq-request-id': 'req_test_456',
          },
        },
      );
    }) as typeof fetch;

    const client = new WebApiClient();

    await expect(client.getCurrentEyeSession()).rejects.toEqual(
      expect.objectContaining({
        status: 403,
        requestId: 'req_test_456',
      } satisfies Partial<WebApiError>),
    );
  });
});
