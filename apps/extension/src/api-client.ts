import type {
  AnalyticsEventCommonProps,
  AnalyticsEventName,
  AuthSessionResponse,
  CapturePageRequest,
  CapturePageResponse,
  EvaluateJobRequest,
  EvaluateJobResponse,
  EyeCurrentResponse,
  RecordClientDiagnosticEventRequest,
  RecordClientDiagnosticEventResponse,
} from '@career-rafiq/contracts';

export const REQUEST_ID_HEADER = 'x-careerrafiq-request-id';
export const EYE_SESSION_HEADER = 'x-careerrafiq-eye-session-id';
export const CLIENT_SURFACE_HEADER = 'x-careerrafiq-client-surface';

export interface ExtensionApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface ExtensionApiClient {
  getSession: () => Promise<AuthSessionResponse>;
  capturePage: (request: CapturePageRequest) => Promise<CapturePageResponse>;
  evaluateJob: (request: EvaluateJobRequest) => Promise<EvaluateJobResponse>;
  getCurrentEyeSession: () => Promise<EyeCurrentResponse>;
  recordClientDiagnosticEvent: (payload: RecordClientDiagnosticEventRequest) => Promise<RecordClientDiagnosticEventResponse>;
  trackAnalyticsEvent: (
    name: AnalyticsEventName,
    properties?: AnalyticsEventCommonProps & Record<string, unknown>,
  ) => Promise<{ ok: true }>;
  setEyeSessionId: (eyeSessionId: string | null) => void;
  getEyeSessionId: () => string | null;
  getLastRequestId: () => string | null;
}

interface ApiErrorPayload {
  error?: string;
  requestId?: string;
}

export class ExtensionApiError extends Error {
  readonly status: number;

  readonly requestId: string | null;

  constructor(status: number, message: string, requestId: string | null) {
    super(message);
    this.name = 'ExtensionApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

async function readJsonOrError<T>(response: Response, onRequestId: (requestId: string | null) => void): Promise<T> {
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  onRequestId(requestId);
  const payload = (await response.json()) as T | ApiErrorPayload;
  if (!response.ok) {
    const errorMessage = (payload as ApiErrorPayload).error;
    const message = typeof errorMessage === 'string' ? errorMessage : `HTTP ${response.status}`;
    throw new ExtensionApiError(response.status, message, (payload as ApiErrorPayload).requestId ?? requestId);
  }
  return payload as T;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/api${path}`;
}

export function createExtensionApiClient(options: ExtensionApiClientOptions): ExtensionApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  let eyeSessionId: string | null = null;
  let lastRequestId: string | null = null;

  const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchImpl(apiUrl(baseUrl, path), {
      credentials: 'include',
      ...init,
      headers: {
        [CLIENT_SURFACE_HEADER]: 'extension',
        ...(eyeSessionId ? { [EYE_SESSION_HEADER]: eyeSessionId } : {}),
        ...(init.headers ?? {}),
      },
    });
    return readJsonOrError<T>(response, (requestId) => {
      lastRequestId = requestId;
    });
  };

  return {
    async getSession() {
      return requestJson<AuthSessionResponse>('/auth/session');
    },
    async capturePage(request) {
      return requestJson<CapturePageResponse>('/capture/page', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    },
    async evaluateJob(request) {
      return requestJson<EvaluateJobResponse>('/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    },
    async getCurrentEyeSession() {
      return requestJson<EyeCurrentResponse>('/ops/eye/current');
    },
    async recordClientDiagnosticEvent(payload) {
      return requestJson<RecordClientDiagnosticEventResponse>('/ops/eye/events/client', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          eyeSessionId: payload.eyeSessionId ?? eyeSessionId,
          clientSurface: payload.clientSurface ?? 'extension',
        }),
      });
    },
    async trackAnalyticsEvent(name, properties) {
      return requestJson<{ ok: true }>('/analytics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(properties ? { name, properties } : { name }),
      });
    },
    setEyeSessionId(nextEyeSessionId) {
      eyeSessionId = nextEyeSessionId;
    },
    getEyeSessionId() {
      return eyeSessionId;
    },
    getLastRequestId() {
      return lastRequestId;
    },
  };
}
