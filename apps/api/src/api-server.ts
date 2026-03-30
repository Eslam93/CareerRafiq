import { access, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import type {
  CaptureJobRequest,
  CaptureManualJobRequest,
  CvUploadCommitDecision,
  CapturePageRequest,
  EvaluateJobRequest,
  ListDiagnosticEventsRequest,
  MagicLinkRequestRequest,
  MagicLinkVerifyRequest,
  RecordClientDiagnosticEventRequest,
  RefreshSetupSuggestionsRequest,
  ResolveTrackerDuplicateRequest,
  SetDefaultCvRequest,
  SetupBootstrapRequest,
  StartEyeSessionRequest,
  TrackAnalyticsEventRequest,
  TrackerStatus,
  UpdateCvProfileRequest,
  UpdateJobReviewRequest,
  UpdatePreferencesRequest,
  UpdateTrackerRecommendationRequest,
  UpdateTrackerVerdictRequest,
} from '@career-rafiq/contracts';
import { getCaptureRateLimitMax, getCaptureRateLimitWindowMs, getServedWebDistDir, getUploadRateLimitMax, getUploadRateLimitWindowMs } from './config.js';
import { sanitizeRequestHeaders } from './eye-diagnostics.js';
import { applyCors, clearCsrfCookie, clearSessionCookie, ensureCsrfCookie, getSessionTokenFromRequest, hasValidCsrfToken, isAllowedRequestOrigin, issueFreshCsrfCookie, readJsonBody, sendJson, setSessionCookie } from './http.js';
import { SlidingWindowRateLimiter } from './request-rate-limit.js';
import { CLIENT_SURFACE_HEADER, EYE_SESSION_HEADER, REQUEST_ID_HEADER, createRequestDiagnosticContext, parseClientSurfaceHeader, runWithRequestDiagnosticContext, updateRequestDiagnosticContext } from './request-context.js';
import { CareerRafiqApiService } from './service.js';
import { readMultipartForm, readMultipartUploads, type ParsedMultipartUpload } from './uploads.js';

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function serveWebAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const webDistDir = getServedWebDistDir();
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const candidate = resolve(webDistDir, normalize(relativePath));
  const safePrefix = resolve(webDistDir);

  if (!candidate.startsWith(safePrefix)) {
    return false;
  }

  const target = (await exists(candidate)) ? candidate : join(webDistDir, 'index.html');
  if (!(await exists(target))) {
    return false;
  }

  const body = await readFile(target);
  response.statusCode = 200;
  response.setHeader('content-type', contentTypeForPath(target));
  response.end(body);
  return true;
}

async function readBootstrapUploads(request: IncomingMessage): Promise<ParsedMultipartUpload[]> {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.includes('multipart/form-data')) {
    return readMultipartUploads(request);
  }

  const body = await readJsonBody<SetupBootstrapRequest>(request);
  return body.uploads.map((upload, index) => ({
    fieldName: `upload_${index}`,
    fileName: upload.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(upload.rawText, 'utf8'),
  }));
}

function parseNumberQuery(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEyeEventsQuery(url: URL): ListDiagnosticEventsRequest {
  return {
    eyeSessionId: url.searchParams.get('eyeSessionId') ?? null,
    requestId: url.searchParams.get('requestId') ?? null,
    jobId: url.searchParams.get('jobId') ?? null,
    area: (url.searchParams.get('area') as ListDiagnosticEventsRequest['area']) ?? null,
    severity: (url.searchParams.get('severity') as ListDiagnosticEventsRequest['severity']) ?? null,
    sinceMinutes: parseNumberQuery(url.searchParams.get('sinceMinutes')),
    limit: parseNumberQuery(url.searchParams.get('limit')),
  };
}

export function createApiServer(service: CareerRafiqApiService = new CareerRafiqApiService()) {
  const uploadRateLimiter = new SlidingWindowRateLimiter();
  const captureRateLimiter = new SlidingWindowRateLimiter();

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const apiPath = url.pathname === '/api' ? '/' : url.pathname.startsWith('/api/') ? url.pathname.slice(4) : null;
    const routePath = apiPath ?? url.pathname;
    const requestContext = createRequestDiagnosticContext({
      method: request.method ?? 'GET',
      routePath,
      origin: request.headers.origin ?? null,
      clientSurface: parseClientSurfaceHeader(request.headers[CLIENT_SURFACE_HEADER]),
    });

    response.setHeader(REQUEST_ID_HEADER, requestContext.requestId);
    response.once('finish', () => {
      service.recordDiagnosticEvent({
        area: 'request',
        stage: 'finish',
        code: 'request_finished',
        severity: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warning' : 'info',
        summary: `Request completed with status ${response.statusCode}.`,
        requestId: requestContext.requestId,
        eyeSessionId: requestContext.eyeSessionId,
        userId: requestContext.userId,
        payload: {
          method: requestContext.method,
          routePath: requestContext.routePath,
          statusCode: response.statusCode,
          clientSurface: requestContext.clientSurface,
          origin: requestContext.origin,
        },
      });
    });

    return runWithRequestDiagnosticContext(requestContext, async () => {
      const sendSuccess = (statusCode: number, payload: unknown): void => {
        sendJson(response, statusCode, payload);
      };

      const sendError = (statusCode: number, error: string, extra: Record<string, unknown> = {}): void => {
        sendJson(response, statusCode, {
          error,
          requestId: requestContext.requestId,
          ...extra,
        });
      };

      let sessionContext = service.getSessionContext(getSessionTokenFromRequest(request));
      if (sessionContext) {
        updateRequestDiagnosticContext({ userId: sessionContext.user.id });
      }

      const ensureAuthenticated = (): boolean => {
        if (!sessionContext) {
          sendError(401, 'Authentication required.');
          return false;
        }
        return true;
      };

      const ensureOperator = (): boolean => {
        if (!ensureAuthenticated()) {
          return false;
        }
        if (!service.isOperatorUser(sessionContext!.user.id)) {
          sendError(403, 'Operator access is required for Eye diagnostics.');
          return false;
        }
        return true;
      };

      const enforceRateLimit = (scope: 'upload' | 'capture'): boolean => {
        const rateLimiter = scope === 'upload' ? uploadRateLimiter : captureRateLimiter;
        const limit = scope === 'upload' ? getUploadRateLimitMax() : getCaptureRateLimitMax();
        const windowMs = scope === 'upload' ? getUploadRateLimitWindowMs() : getCaptureRateLimitWindowMs();
        const actorKey = sessionContext?.user.id ?? request.socket.remoteAddress ?? 'anonymous';
        const result = rateLimiter.check(`${scope}:${actorKey}`, limit, windowMs);
        if (result.allowed) {
          return false;
        }
        response.setHeader('retry-after', String(result.retryAfterSeconds));
        service.recordDiagnosticEvent({
          area: scope === 'upload' ? 'runtime' : 'capture',
          stage: 'rate_limit',
          code: `${scope}_rate_limited`,
          severity: 'warning',
          summary: `Request was blocked by the ${scope} rate limit.`,
          userId: sessionContext?.user.id ?? null,
          payload: {
            actorKey,
            retryAfterSeconds: result.retryAfterSeconds,
            limit,
            windowMs,
          },
        });
        sendError(429, `Too many ${scope} requests. Retry in ${result.retryAfterSeconds} seconds.`);
        return true;
      };

      try {
        if (applyCors(request, response)) {
          return;
        }

        service.recordDiagnosticEvent({
          area: 'request',
          stage: 'start',
          code: 'request_started',
          severity: 'info',
          summary: 'Request started.',
          payload: {
            method: requestContext.method,
            routePath: requestContext.routePath,
            clientSurface: requestContext.clientSurface,
            origin: requestContext.origin,
            headers: sanitizeRequestHeaders(request.headers),
            query: Object.fromEntries(url.searchParams.entries()),
          },
        });

        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method ?? '') && !isAllowedRequestOrigin(request)) {
          service.recordDiagnosticEvent({
            area: 'auth',
            stage: 'origin',
            code: 'auth_origin_rejected',
            severity: 'warning',
            summary: 'Request origin was rejected.',
            userId: sessionContext?.user.id ?? null,
            payload: {
              origin: request.headers.origin ?? null,
              routePath,
            },
          });
          sendError(403, 'Origin is not allowed.');
          return;
        }

        const requestedEyeSessionValue = request.headers[EYE_SESSION_HEADER];
        const requestedEyeSessionId = Array.isArray(requestedEyeSessionValue)
          ? requestedEyeSessionValue[0] ?? null
          : requestedEyeSessionValue ?? null;
        if (requestedEyeSessionId) {
          if (sessionContext && service.isOperatorUser(sessionContext.user.id)) {
            const activeEyeSession = service.getEyeCurrent(sessionContext.user.id).session;
            if (activeEyeSession && activeEyeSession.id === requestedEyeSessionId && activeEyeSession.status === 'active') {
              updateRequestDiagnosticContext({ eyeSessionId: activeEyeSession.id });
            } else {
              service.recordDiagnosticEvent({
                area: 'ops',
                stage: 'session',
                code: 'eye_session_header_ignored',
                severity: 'warning',
                userId: sessionContext.user.id,
                summary: 'Incoming Eye session header did not match the active operator session and was ignored.',
                payload: {
                  requestedEyeSessionId,
                  activeEyeSessionId: activeEyeSession?.id ?? null,
                },
              });
            }
          } else {
            service.recordDiagnosticEvent({
              area: 'ops',
              stage: 'session',
              code: 'eye_session_header_ignored',
              severity: 'warning',
              userId: sessionContext?.user.id ?? null,
              summary: 'Incoming Eye session header was ignored because the request was not from an operator session.',
              payload: {
                requestedEyeSessionId,
              },
            });
          }
        }

        if (request.method === 'GET' && routePath === '/health') {
          sendSuccess(200, { ok: true, timestamp: new Date().toISOString() });
          return;
        }

        if (request.method === 'GET' && routePath === '/ready') {
          const readiness = service.getRuntimeReadiness();
          const webBundleReady = await exists(join(getServedWebDistDir(), 'index.html'));
          const ok = readiness.checks.databaseReady && webBundleReady && readiness.warnings.length === 0;
          sendSuccess(ok ? 200 : 503, {
            ...readiness,
            ok,
            checks: {
              ...readiness.checks,
              webBundleReady,
            },
          });
          return;
        }

        if (request.method === 'GET' && routePath === '/auth/session') {
          ensureCsrfCookie(request, response);
          sendSuccess(200, service.getAuthSession(getSessionTokenFromRequest(request)));
          return;
        }

        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method ?? '') && getSessionTokenFromRequest(request) && request.headers.origin && !hasValidCsrfToken(request)) {
          service.recordDiagnosticEvent({
            area: 'auth',
            stage: 'csrf',
            code: 'auth_csrf_invalid',
            severity: 'warning',
            summary: 'CSRF validation failed.',
            userId: sessionContext?.user.id ?? null,
            payload: {
              routePath,
              origin: request.headers.origin ?? null,
              csrfHeaderPresent: Boolean(request.headers['x-careerrafiq-csrf']),
            },
          });
          sendError(403, 'CSRF token is missing or invalid.');
          return;
        }

        if (request.method === 'POST' && (routePath === '/setup/bootstrap' || routePath === '/bootstrap')) {
          if (enforceRateLimit('upload')) {
            return;
          }
          const uploads = await readBootstrapUploads(request);
          const result = await service.bootstrapFromUploads(uploads);
          setSessionCookie(response, result.sessionToken, result.sessionExpiresAt);
          issueFreshCsrfCookie(response);
          const { sessionToken: _sessionToken, sessionExpiresAt: _sessionExpiresAt, ...payload } = result;
          sendSuccess(200, payload);
          return;
        }

        if (request.method === 'GET' && (routePath === '/setup/current' || routePath === '/bootstrap/current')) {
          if (!sessionContext) {
            sendSuccess(200, { bootstrap: null });
            return;
          }
          sendSuccess(200, service.getSetupCurrent(sessionContext.user.id));
          return;
        }

        if (request.method === 'POST' && routePath === '/setup/cvs') {
          if (!ensureAuthenticated()) {
            return;
          }
          if (enforceRateLimit('upload')) {
            return;
          }
          const uploads = await readBootstrapUploads(request);
          sendSuccess(200, await service.uploadAdditionalCvs(sessionContext!.user.id, uploads));
          return;
        }

        if (request.method === 'GET' && routePath === '/cvs') {
          if (!ensureAuthenticated()) {
            return;
          }
          sendSuccess(200, service.listCvs(sessionContext!.user.id));
          return;
        }

        if (request.method === 'GET' && routePath.startsWith('/cvs/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const parts = routePath.split('/').filter(Boolean);
          const cvId = parts[1];
          const action = parts[2] ?? null;
          if (!cvId || action) {
            sendError(404, 'Route not found.');
            return;
          }
          sendSuccess(200, service.getCvDetail(sessionContext!.user.id, cvId));
          return;
        }

        if (request.method === 'POST' && routePath === '/cvs/uploads/analyze') {
          if (!ensureAuthenticated()) {
            return;
          }
          if (enforceRateLimit('upload')) {
            return;
          }
          const uploads = await readBootstrapUploads(request);
          sendSuccess(200, await service.analyzeCvUploads(sessionContext!.user.id, uploads));
          return;
        }

        if (request.method === 'POST' && routePath === '/cvs/uploads/commit') {
          if (!ensureAuthenticated()) {
            return;
          }
          if (enforceRateLimit('upload')) {
            return;
          }
          const form = await readMultipartForm(request);
          const decisionsRaw = form.fields['decisions']?.[0] ?? '[]';
          let decisions: CvUploadCommitDecision[] = [];
          try {
            const parsed = JSON.parse(decisionsRaw) as unknown;
            if (!Array.isArray(parsed)) {
              throw new Error('decisions must be an array.');
            }
            decisions = parsed as CvUploadCommitDecision[];
          } catch (error) {
            sendError(400, error instanceof Error ? error.message : 'Invalid commit decisions payload.');
            return;
          }
          sendSuccess(200, await service.commitCvUploads(sessionContext!.user.id, form.uploads, decisions));
          return;
        }

        if (request.method === 'PATCH' && routePath.startsWith('/cvs/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const parts = routePath.split('/').filter(Boolean);
          const cvId = parts[1];
          const action = parts[2];
          if (!cvId || action !== 'default') {
            sendError(404, 'Route not found.');
            return;
          }
          sendSuccess(200, service.setDefaultCv(sessionContext!.user.id, cvId, true));
          return;
        }

        if (request.method === 'PATCH' && routePath === '/setup/default-cv') {
          if (!ensureAuthenticated()) {
            return;
          }
          const body = await readJsonBody<SetDefaultCvRequest>(request);
          sendSuccess(200, service.setDefaultCv(sessionContext!.user.id, body.cvId, body.reevaluateTrackedJobs !== false));
          return;
        }

        if (request.method === 'POST' && routePath === '/setup/suggestions/refresh') {
          if (!ensureAuthenticated()) {
            return;
          }
          const body = await readJsonBody<RefreshSetupSuggestionsRequest>(request);
          sendSuccess(200, await service.refreshSetupSuggestions(sessionContext!.user.id, body.reevaluateTrackedJobs !== false));
          return;
        }

        if (request.method === 'PATCH' && routePath.startsWith('/cv-profiles/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const cvId = routePath.split('/').filter(Boolean)[1];
          if (!cvId) {
            sendError(400, 'Missing CV id.');
            return;
          }
          const body = await readJsonBody<UpdateCvProfileRequest>(request);
          sendSuccess(200, service.updateCvProfile(sessionContext!.user.id, cvId, body));
          return;
        }

        if (request.method === 'PATCH' && routePath === '/preferences') {
          if (!ensureAuthenticated()) {
            return;
          }
          const body = await readJsonBody<UpdatePreferencesRequest>(request);
          sendSuccess(200, service.updatePreferences(sessionContext!.user.id, body));
          return;
        }

        if (request.method === 'POST' && (routePath === '/auth/magic-link/request' || routePath === '/magic-link/send')) {
          const body = await readJsonBody<MagicLinkRequestRequest>(request);
          sendSuccess(200, await service.requestMagicLink(sessionContext, body));
          return;
        }

        if (request.method === 'GET' && routePath === '/auth/magic-link/consume') {
          const token = url.searchParams.get('token');
          const email = url.searchParams.get('email') ?? undefined;
          if (!token) {
            sendError(400, 'Missing token.');
            return;
          }
          const result = service.consumeMagicLink(token, email);
          if (result.sessionToken) {
            setSessionCookie(response, result.sessionToken, result.sessionExpiresAt);
            issueFreshCsrfCookie(response);
          }
          const { sessionToken: _sessionToken, sessionExpiresAt: _sessionExpiresAt, ...payload } = result;
          sendSuccess(200, payload);
          return;
        }

        if (request.method === 'POST' && routePath === '/magic-link/verify') {
          const body = await readJsonBody<MagicLinkVerifyRequest>(request);
          const result = service.consumeMagicLink(body.token, body.email);
          if (result.sessionToken) {
            setSessionCookie(response, result.sessionToken, result.sessionExpiresAt);
            issueFreshCsrfCookie(response);
          }
          const { sessionToken: _sessionToken, sessionExpiresAt: _sessionExpiresAt, ...payload } = result;
          sendSuccess(200, payload);
          return;
        }

        if (request.method === 'POST' && routePath === '/auth/logout') {
          clearSessionCookie(response);
          clearCsrfCookie(response);
          sendSuccess(200, service.logout(getSessionTokenFromRequest(request)));
          return;
        }

        if (request.method === 'POST' && routePath === '/analytics') {
          if (!ensureAuthenticated()) {
            return;
          }
          const body = await readJsonBody<TrackAnalyticsEventRequest>(request);
          sendSuccess(200, service.trackAnalyticsEvent(sessionContext!, body));
          return;
        }

        if (request.method === 'GET' && routePath === '/ops/summary') {
          if (!ensureAuthenticated()) {
            return;
          }
          sendSuccess(200, service.getOpsSummary(sessionContext!.user.id));
          return;
        }

        if (request.method === 'GET' && routePath === '/ops/runtime-detail') {
          if (!ensureOperator()) {
            return;
          }
          sendSuccess(200, service.getRuntimeDetail(sessionContext!.user.id));
          return;
        }

        if (request.method === 'GET' && routePath === '/ops/eye/current') {
          if (!ensureOperator()) {
            return;
          }
          sendSuccess(200, service.getEyeCurrent(sessionContext!.user.id));
          return;
        }

        if (request.method === 'GET' && routePath === '/ops/eye/sessions') {
          if (!ensureOperator()) {
            return;
          }
          sendSuccess(200, service.listEyeSessions(sessionContext!.user.id));
          return;
        }

        if (request.method === 'POST' && routePath === '/ops/eye/sessions') {
          if (!ensureOperator()) {
            return;
          }
          const body = await readJsonBody<StartEyeSessionRequest>(request);
          sendSuccess(200, service.startEyeSession(sessionContext!.user.id, body));
          return;
        }

        if (request.method === 'PATCH' && apiPath?.startsWith('/ops/eye/sessions/')) {
          if (!ensureOperator()) {
            return;
          }
          const parts = apiPath.split('/').filter(Boolean);
          const sessionId = parts[3];
          const action = parts[4];
          if (!sessionId || action !== 'stop') {
            sendError(404, 'Route not found.');
            return;
          }
          sendSuccess(200, service.stopEyeSession(sessionContext!.user.id, sessionId));
          return;
        }

        if (request.method === 'GET' && routePath === '/ops/eye/events') {
          if (!ensureOperator()) {
            return;
          }
          sendSuccess(200, service.listDiagnosticEvents(sessionContext!.user.id, parseEyeEventsQuery(url)));
          return;
        }

        if (request.method === 'GET' && apiPath?.startsWith('/ops/eye/events/')) {
          if (!ensureOperator()) {
            return;
          }
          const parts = apiPath.split('/').filter(Boolean);
          const eventId = parts[3];
          if (!eventId) {
            sendError(400, 'Missing diagnostic event id.');
            return;
          }
          sendSuccess(200, service.getDiagnosticEvent(sessionContext!.user.id, eventId));
          return;
        }

        if (request.method === 'POST' && routePath === '/ops/eye/events/client') {
          if (!ensureOperator()) {
            return;
          }
          const body = await readJsonBody<RecordClientDiagnosticEventRequest>(request);
          sendSuccess(200, service.recordClientDiagnosticEvent(sessionContext!.user.id, body));
          return;
        }

        if (request.method === 'POST' && routePath === '/extract') {
          const body = await readJsonBody<CapturePageRequest>(request);
          sendSuccess(200, service.extractPage(body));
          return;
        }

        if (request.method === 'POST' && routePath === '/capture/page') {
          if (!ensureAuthenticated()) {
            return;
          }
          if (enforceRateLimit('capture')) {
            return;
          }
          const body = await readJsonBody<CapturePageRequest>(request);
          sendSuccess(200, await service.capturePage(sessionContext!.user.id, body));
          return;
        }

        if (request.method === 'POST' && routePath === '/capture/manual') {
          if (!ensureAuthenticated()) {
            return;
          }
          if (enforceRateLimit('capture')) {
            return;
          }
          const body = await readJsonBody<CaptureManualJobRequest>(request);
          sendSuccess(200, await service.captureManual(sessionContext!.user.id, body));
          return;
        }

        if (request.method === 'POST' && routePath === '/capture') {
          if (!ensureAuthenticated()) {
            return;
          }
          if (enforceRateLimit('capture')) {
            return;
          }
          const body = await readJsonBody<CaptureJobRequest>(request);
          sendSuccess(200, await service.captureExtractedJob(sessionContext!.user.id, body.extraction));
          return;
        }

        if (request.method === 'GET' && apiPath?.startsWith('/jobs/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const parts = apiPath.split('/').filter(Boolean);
          const jobId = parts[1];
          const action = parts[2];
          if (action === 'review' && jobId) {
            sendSuccess(200, service.getJobReview(sessionContext!.user.id, jobId));
            return;
          }
        }

        if (request.method === 'PATCH' && apiPath?.startsWith('/jobs/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const parts = apiPath.split('/').filter(Boolean);
          const jobId = parts[1];
          const action = parts[2];
          if (action === 'review' && jobId) {
            const body = await readJsonBody<UpdateJobReviewRequest>(request);
            sendSuccess(200, service.updateJobReview(sessionContext!.user.id, jobId, body));
            return;
          }
        }

        if (request.method === 'POST' && apiPath?.startsWith('/jobs/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const parts = apiPath.split('/').filter(Boolean);
          const jobId = parts[1];
          const action = parts[2];
          if (action === 'evaluate' && jobId) {
            sendSuccess(200, await service.evaluateJob(sessionContext!.user.id, jobId));
            return;
          }
          if (action === 'reprocess' && jobId) {
            if (enforceRateLimit('capture')) {
              return;
            }
            const body = await readJsonBody<{ reevaluateAfterReprocess?: boolean }>(request);
            sendSuccess(200, await service.reprocessJob(sessionContext!.user.id, jobId, body.reevaluateAfterReprocess === true));
            return;
          }
        }

        if (request.method === 'POST' && routePath === '/evaluate') {
          if (!ensureAuthenticated()) {
            return;
          }
          const body = await readJsonBody<EvaluateJobRequest>(request);
          sendSuccess(200, await service.evaluateJob(sessionContext!.user.id, body.jobId));
          return;
        }

        if (request.method === 'GET' && apiPath === '/tracker') {
          if (!ensureAuthenticated()) {
            return;
          }
          sendSuccess(200, service.listTracker(sessionContext!.user.id));
          return;
        }

        if (request.method === 'GET' && apiPath?.startsWith('/tracker/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const parts = apiPath.split('/').filter(Boolean);
          const jobId = parts[1];
          const action = parts[2];
          if (!jobId) {
            sendError(400, 'Missing job id.');
            return;
          }
          if (!action || action === 'detail') {
            sendSuccess(200, service.getTrackerDetail(sessionContext!.user.id, jobId));
            return;
          }
        }

        if (request.method === 'PATCH' && apiPath?.startsWith('/tracker/')) {
          if (!ensureAuthenticated()) {
            return;
          }
          const parts = apiPath.split('/').filter(Boolean);
          const jobId = parts[1];
          const action = parts[2];
          if (!jobId) {
            sendError(400, 'Missing job id.');
            return;
          }
          if (action === 'status') {
            const body = await readJsonBody<{ status: TrackerStatus }>(request);
            sendSuccess(200, service.updateTrackerStatus(sessionContext!.user.id, jobId, body.status));
            return;
          }
          if (action === 'recommendation') {
            const body = await readJsonBody<UpdateTrackerRecommendationRequest>(request);
            sendSuccess(200, service.updateTrackerRecommendationDecision(sessionContext!.user.id, jobId, body));
            return;
          }
          if (action === 'verdict') {
            const body = await readJsonBody<UpdateTrackerVerdictRequest>(request);
            sendSuccess(200, service.updateTrackerVerdictDecision(sessionContext!.user.id, jobId, body));
            return;
          }
          if (action === 'duplicate') {
            const body = await readJsonBody<ResolveTrackerDuplicateRequest>(request);
            sendSuccess(200, service.resolveTrackerDuplicate(sessionContext!.user.id, jobId, body));
            return;
          }
          if (action === 'note') {
            const body = await readJsonBody<{ note: string }>(request);
            sendSuccess(200, service.appendTrackerNote(sessionContext!.user.id, jobId, body.note));
            return;
          }
        }

        if (request.method === 'GET' && routePath === '/dev/email-outbox/latest') {
          const email = url.searchParams.get('email');
          if (!email) {
            sendError(400, 'Missing email query parameter.');
            return;
          }
          sendSuccess(200, {
            message: service.getLatestDevOutbox(email),
          });
          return;
        }

        if (request.method === 'GET' && (await serveWebAsset(url.pathname, response))) {
          return;
        }

        sendError(404, 'Route not found.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        service.recordDiagnosticEvent({
          area: 'runtime',
          stage: 'exception',
          code: 'request_unhandled_error',
          severity: 'error',
          summary: 'Unhandled request error.',
          userId: requestContext.userId,
          payload: {
            method: requestContext.method,
            routePath: requestContext.routePath,
            error: message,
          },
        });
        sendError(500, message);
      }
    });
  });
}
