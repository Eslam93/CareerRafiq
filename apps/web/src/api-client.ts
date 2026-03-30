import type {
  AnalyzeCvUploadResponse,
  AnalyticsEventCommonProps,
  AnalyticsEventName,
  AuthSessionResponse,
  CaptureJobResponse,
  CaptureManualJobRequest,
  CommitCvUploadResponse,
  CvDetailResponse,
  CvListResponse,
  CvUploadCommitDecision,
  DiagnosticEventResponse,
  DiagnosticEventsResponse,
  DevEmailOutboxResponse,
  EyeCurrentResponse,
  EyeSessionResponse,
  EyeSessionsResponse,
  EvaluationResult,
  JobReviewResponse,
  ListDiagnosticEventsRequest,
  OpsSummaryResponse,
  PreferenceProfile,
  RecordClientDiagnosticEventRequest,
  RecordClientDiagnosticEventResponse,
  RefreshSetupSuggestionsResponse,
  RuntimeDetailResponse,
  RuntimeReadinessResponse,
  SetDefaultCvResponse,
  SetupBootstrapResponse,
  SetupCurrentResponse,
  StartEyeSessionRequest,
  TrackerItem,
  TrackerDetailResponse,
  TrackerListResponse,
  TrackerStatus,
  UpdateCvProfileRequest,
  UpdateCvProfileResponse,
  UpdateJobReviewRequest,
  ResolveTrackerDuplicateRequest,
  ResolveTrackerDuplicateResponse,
  User,
  UploadAdditionalCvsResponse,
  WorkSetup,
  EmploymentType,
  UpdateTrackerRecommendationRequest,
  UpdateTrackerRecommendationResponse,
  UpdateTrackerVerdictRequest,
  UpdateTrackerVerdictResponse,
} from '@career-rafiq/contracts';

export interface UpdatePreferencesResponse {
  preferenceProfile: PreferenceProfile;
  audits: Array<{
    type: 'duplicate' | 'near_duplicate' | 'contradiction' | 'weak_value';
    severity: 'info' | 'warning';
    message: string;
  }>;
  reevaluatedJobIds: string[];
}

export interface MagicLinkRequestResponse {
  sentTo: string;
  expiresAt: string | null;
}

export interface MagicLinkConsumeResponse {
  verified: boolean;
  userId: string | null;
  accessLevel?: 'temporary' | 'verified';
  user?: User | null;
}

export interface EvaluateJobResponse {
  evaluation: EvaluationResult;
  trackerItem: TrackerItem | null;
  recommendedCvName: string | null;
}

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface WebApiClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class WebApiError extends Error {
  readonly status: number;

  readonly body: string;

  readonly requestId: string | null;

  constructor(status: number, body: string, requestId: string | null, message?: string) {
    super(message ?? `API request failed with status ${status}.`);
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

const CSRF_COOKIE_NAME = 'career_rafiq_csrf';
const CSRF_HEADER_NAME = 'x-careerrafiq-csrf';
export const REQUEST_ID_HEADER = 'x-careerrafiq-request-id';
export const EYE_SESSION_HEADER = 'x-careerrafiq-eye-session-id';
export const CLIENT_SURFACE_HEADER = 'x-careerrafiq-client-surface';
const EYE_SESSION_STORAGE_KEY = 'careerrafiq.eye_session_id';

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStoredEyeSessionId(): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  return window.localStorage.getItem(EYE_SESSION_STORAGE_KEY);
}

export function setStoredEyeSessionId(eyeSessionId: string | null): void {
  if (!canUseLocalStorage()) {
    return;
  }
  if (!eyeSessionId) {
    window.localStorage.removeItem(EYE_SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(EYE_SESSION_STORAGE_KEY, eyeSessionId);
}

function buildUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function buildApiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/api${normalized}`;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }
  const body = await response.text();
  let requestId = response.headers.get(REQUEST_ID_HEADER);
  let errorMessage: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: string; requestId?: string };
    requestId = parsed.requestId ?? requestId;
    errorMessage = parsed.error;
  } catch {
    errorMessage = undefined;
  }
  throw new WebApiError(response.status, body, requestId, errorMessage);
}

function getBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const cookieEntry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookieEntry) {
    return null;
  }
  return decodeURIComponent(cookieEntry.slice(name.length + 1));
}

function buildMutationHeaders(existingHeaders: HeadersInit | undefined): HeadersInit {
  const normalizedHeaders = Object.fromEntries(new Headers(existingHeaders ?? {}).entries());
  const csrfToken = getBrowserCookie(CSRF_COOKIE_NAME);
  return {
    ...normalizedHeaders,
    ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
  };
}

function buildRequestHeaders(existingHeaders: HeadersInit | undefined, isMutation: boolean): HeadersInit {
  const baseHeaders = isMutation ? buildMutationHeaders(existingHeaders) : Object.fromEntries(new Headers(existingHeaders ?? {}).entries());
  const eyeSessionId = getStoredEyeSessionId();
  return {
    ...baseHeaders,
    [CLIENT_SURFACE_HEADER]: 'web',
    ...(eyeSessionId ? { [EYE_SESSION_HEADER]: eyeSessionId } : {}),
  };
}

export class WebApiClient {
  private readonly baseUrl: string;

  private readonly fetchImpl: FetchLike;

  constructor(options: WebApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getSession(): Promise<AuthSessionResponse> {
    return this.requestJson<AuthSessionResponse>(buildApiPath('/auth/session'));
  }

  async bootstrapFromFiles(files: readonly File[]): Promise<SetupBootstrapResponse> {
    return this.uploadFiles<SetupBootstrapResponse>(buildApiPath('/setup/bootstrap'), files);
  }

  async getCurrentSetup(): Promise<SetupCurrentResponse> {
    return this.requestJson<SetupCurrentResponse>(buildApiPath('/setup/current'));
  }

  async uploadAdditionalCvs(files: readonly File[]): Promise<UploadAdditionalCvsResponse> {
    return this.uploadFiles<UploadAdditionalCvsResponse>(buildApiPath('/setup/cvs'), files);
  }

  async listCvs(): Promise<CvListResponse> {
    return this.requestJson<CvListResponse>(buildApiPath('/cvs'));
  }

  async getCvDetail(cvId: string): Promise<CvDetailResponse> {
    return this.requestJson<CvDetailResponse>(buildApiPath(`/cvs/${encodeURIComponent(cvId)}`));
  }

  async analyzeCvUploads(files: readonly File[]): Promise<AnalyzeCvUploadResponse> {
    return this.uploadFiles<AnalyzeCvUploadResponse>(buildApiPath('/cvs/uploads/analyze'), files);
  }

  async commitCvUploads(files: readonly File[], decisions: readonly CvUploadCommitDecision[]): Promise<CommitCvUploadResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('uploads', file, file.name);
    }
    formData.append('decisions', JSON.stringify(decisions));
    const response = await this.fetchImpl(buildUrl(this.baseUrl, buildApiPath('/cvs/uploads/commit')), {
      method: 'POST',
      credentials: 'include',
      headers: buildRequestHeaders(undefined, true),
      body: formData,
    });
    return parseJsonOrThrow<CommitCvUploadResponse>(response);
  }

  async setDefaultCv(cvId: string, reevaluateTrackedJobs = true): Promise<SetDefaultCvResponse> {
    return this.requestJson<SetDefaultCvResponse>(buildApiPath('/setup/default-cv'), {
      method: 'PATCH',
      body: JSON.stringify({ cvId, reevaluateTrackedJobs }),
    });
  }

  async setCvDefault(cvId: string): Promise<SetDefaultCvResponse> {
    return this.requestJson<SetDefaultCvResponse>(buildApiPath(`/cvs/${encodeURIComponent(cvId)}/default`), {
      method: 'PATCH',
    });
  }

  async refreshSetupSuggestions(reevaluateTrackedJobs = true): Promise<RefreshSetupSuggestionsResponse> {
    return this.requestJson<RefreshSetupSuggestionsResponse>(buildApiPath('/setup/suggestions/refresh'), {
      method: 'POST',
      body: JSON.stringify({ reevaluateTrackedJobs }),
    });
  }

  async updateCvProfile(cvId: string, patch: UpdateCvProfileRequest): Promise<UpdateCvProfileResponse> {
    return this.requestJson<UpdateCvProfileResponse>(buildApiPath(`/cv-profiles/${encodeURIComponent(cvId)}`), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async updatePreferences(preferenceProfile: PreferenceProfile, reevaluateTrackedJobs = true): Promise<UpdatePreferencesResponse> {
    return this.requestJson<UpdatePreferencesResponse>(buildApiPath('/preferences'), {
      method: 'PATCH',
      body: JSON.stringify({ preferenceProfile, reevaluateTrackedJobs }),
    });
  }

  async requestMagicLink(email: string): Promise<MagicLinkRequestResponse> {
    return this.requestJson<MagicLinkRequestResponse>(buildApiPath('/auth/magic-link/request'), {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async consumeMagicLink(token: string, email: string | null): Promise<MagicLinkConsumeResponse> {
    const params = new URLSearchParams({ token });
    if (email) params.set('email', email);
    return this.requestJson<MagicLinkConsumeResponse>(buildApiPath(`/auth/magic-link/consume?${params.toString()}`));
  }

  async getJobReview(jobId: string): Promise<JobReviewResponse> {
    return this.requestJson<JobReviewResponse>(buildApiPath(`/jobs/${encodeURIComponent(jobId)}/review`));
  }

  async captureManual(payload: CaptureManualJobRequest): Promise<CaptureJobResponse> {
    return this.requestJson<CaptureJobResponse>(buildApiPath('/capture/manual'), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async saveJobReview(jobId: string, patch: UpdateJobReviewRequest): Promise<JobReviewResponse> {
    return this.requestJson<JobReviewResponse>(buildApiPath(`/jobs/${encodeURIComponent(jobId)}/review`), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async reprocessJob(jobId: string, reevaluateAfterReprocess = false): Promise<JobReviewResponse> {
    return this.requestJson<JobReviewResponse>(buildApiPath(`/jobs/${encodeURIComponent(jobId)}/reprocess`), {
      method: 'POST',
      body: JSON.stringify({ reevaluateAfterReprocess }),
    });
  }

  async evaluateJob(jobId: string): Promise<EvaluateJobResponse> {
    return this.requestJson<EvaluateJobResponse>(buildApiPath(`/jobs/${encodeURIComponent(jobId)}/evaluate`), {
      method: 'POST',
    });
  }

  async getTrackerList(): Promise<TrackerListResponse> {
    return this.requestJson<TrackerListResponse>(buildApiPath('/tracker'));
  }

  async getTrackerDetail(jobId: string): Promise<TrackerDetailResponse> {
    return this.requestJson<TrackerDetailResponse>(buildApiPath(`/tracker/${encodeURIComponent(jobId)}`));
  }

  async updateTrackerRecommendation(
    jobId: string,
    payload: UpdateTrackerRecommendationRequest,
  ): Promise<UpdateTrackerRecommendationResponse> {
    return this.requestJson<UpdateTrackerRecommendationResponse>(
      buildApiPath(`/tracker/${encodeURIComponent(jobId)}/recommendation`),
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    );
  }

  async updateTrackerVerdict(
    jobId: string,
    payload: UpdateTrackerVerdictRequest,
  ): Promise<UpdateTrackerVerdictResponse> {
    return this.requestJson<UpdateTrackerVerdictResponse>(buildApiPath(`/tracker/${encodeURIComponent(jobId)}/verdict`), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async resolveTrackerDuplicate(
    jobId: string,
    payload: ResolveTrackerDuplicateRequest,
  ): Promise<ResolveTrackerDuplicateResponse> {
    return this.requestJson<ResolveTrackerDuplicateResponse>(buildApiPath(`/tracker/${encodeURIComponent(jobId)}/duplicate`), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async updateTrackerStatus(jobId: string, status: TrackerStatus): Promise<TrackerDetailResponse> {
    return this.requestJson<TrackerDetailResponse>(buildApiPath(`/tracker/${encodeURIComponent(jobId)}/status`), {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async addTrackerNote(jobId: string, note: string): Promise<TrackerDetailResponse> {
    return this.requestJson<TrackerDetailResponse>(buildApiPath(`/tracker/${encodeURIComponent(jobId)}/note`), {
      method: 'PATCH',
      body: JSON.stringify({ note }),
    });
  }

  async getOpsSummary(): Promise<OpsSummaryResponse> {
    return this.requestJson<OpsSummaryResponse>(buildApiPath('/ops/summary'));
  }

  async getRuntimeDetail(): Promise<RuntimeDetailResponse> {
    return this.requestJson<RuntimeDetailResponse>(buildApiPath('/ops/runtime-detail'));
  }

  async getRuntimeReadiness(): Promise<RuntimeReadinessResponse> {
    return this.requestJson<RuntimeReadinessResponse>(buildApiPath('/ready'));
  }

  async getCurrentEyeSession(): Promise<EyeCurrentResponse> {
    return this.requestJson<EyeCurrentResponse>(buildApiPath('/ops/eye/current'));
  }

  async startEyeSession(payload: StartEyeSessionRequest): Promise<EyeSessionResponse> {
    return this.requestJson<EyeSessionResponse>(buildApiPath('/ops/eye/sessions'), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async stopEyeSession(sessionId: string): Promise<EyeSessionResponse> {
    return this.requestJson<EyeSessionResponse>(buildApiPath(`/ops/eye/sessions/${encodeURIComponent(sessionId)}/stop`), {
      method: 'PATCH',
    });
  }

  async listEyeSessions(): Promise<EyeSessionsResponse> {
    return this.requestJson<EyeSessionsResponse>(buildApiPath('/ops/eye/sessions'));
  }

  async listDiagnosticEvents(filters: ListDiagnosticEventsRequest = {}): Promise<DiagnosticEventsResponse> {
    const params = new URLSearchParams();
    if (filters.eyeSessionId) params.set('eyeSessionId', filters.eyeSessionId);
    if (filters.requestId) params.set('requestId', filters.requestId);
    if (filters.jobId) params.set('jobId', filters.jobId);
    if (filters.area) params.set('area', filters.area);
    if (filters.severity) params.set('severity', filters.severity);
    if (typeof filters.sinceMinutes === 'number') params.set('sinceMinutes', String(filters.sinceMinutes));
    if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));
    const suffix = params.toString();
    return this.requestJson<DiagnosticEventsResponse>(buildApiPath(`/ops/eye/events${suffix ? `?${suffix}` : ''}`));
  }

  async getDiagnosticEvent(eventId: string): Promise<DiagnosticEventResponse> {
    return this.requestJson<DiagnosticEventResponse>(buildApiPath(`/ops/eye/events/${encodeURIComponent(eventId)}`));
  }

  async recordClientDiagnosticEvent(payload: RecordClientDiagnosticEventRequest): Promise<RecordClientDiagnosticEventResponse> {
    return this.requestJson<RecordClientDiagnosticEventResponse>(buildApiPath('/ops/eye/events/client'), {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        eyeSessionId: payload.eyeSessionId ?? getStoredEyeSessionId(),
        clientSurface: payload.clientSurface ?? 'web',
      }),
    });
  }

  private async uploadFiles<T>(path: string, files: readonly File[]): Promise<T> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('uploads', file, file.name);
    }
    const response = await this.fetchImpl(buildUrl(this.baseUrl, path), {
      method: 'POST',
      credentials: 'include',
      headers: buildRequestHeaders(undefined, true),
      body: formData,
    });
    return parseJsonOrThrow<T>(response);
  }

  async getLatestDevEmailOutbox(email: string): Promise<DevEmailOutboxResponse> {
    const params = new URLSearchParams({ email });
    return this.requestJson<DevEmailOutboxResponse>(buildApiPath(`/dev/email-outbox/latest?${params.toString()}`));
  }

  async logout(): Promise<{ ok: true }> {
    return this.requestJson<{ ok: true }>(buildApiPath('/auth/logout'), {
      method: 'POST',
    });
  }

  async trackAnalyticsEvent(
    name: AnalyticsEventName,
    properties?: AnalyticsEventCommonProps & Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const body = properties ? { name, properties } : { name };
    return this.requestJson<{ ok: true }>(buildApiPath('/analytics'), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const hasBody = typeof init.body === 'string';
    const isMutation = (init.method ?? 'GET') !== 'GET';
    const response = await this.fetchImpl(buildUrl(this.baseUrl, path), {
      method: init.method ?? 'GET',
      credentials: 'include',
      ...init,
      headers: {
        ...buildRequestHeaders(init.headers, isMutation),
        ...(hasBody ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      },
    });
    return parseJsonOrThrow<T>(response);
  }
}

export const webApiClient = new WebApiClient();
