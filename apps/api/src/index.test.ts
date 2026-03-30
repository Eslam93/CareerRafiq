import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CareerRafiqRepository } from '@career-rafiq/db';
import { createApiServer } from './index.js';
import { CareerRafiqApiService } from './service.js';

interface StartedServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(dbFilePath: string): Promise<StartedServer> {
  const repository = CareerRafiqRepository.open(dbFilePath);
  const service = new CareerRafiqApiService({ repository });
  const server = createApiServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      service.close();
    },
  };
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  apply(init: RequestInit = {}): RequestInit {
    const cookieHeader = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    return {
      ...init,
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(init.headers ?? {}),
      },
    };
  }

  capture(response: Response): void {
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const cookieLines = typeof getSetCookie === 'function'
      ? getSetCookie.call(response.headers)
      : (response.headers.get('set-cookie')
          ? response.headers.get('set-cookie')!.split(/,(?=[^;,\s]+=)/g)
          : []);
    if (cookieLines.length === 0) {
      return;
    }
    for (const cookieLine of cookieLines) {
      const firstSegment = cookieLine.split(';', 1)[0] ?? '';
      const separatorIndex = firstSegment.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }
      const name = firstSegment.slice(0, separatorIndex);
      const value = firstSegment.slice(separatorIndex + 1);
      this.cookies.set(name, value);
    }
  }

  get(name: string): string | null {
    return this.cookies.get(name) ?? null;
  }
}

function extractTokenFromOutbox(body: string): string {
  const match = body.match(/token=([^&]+)&email=/);
  if (!match?.[1]) {
    throw new Error('Magic-link token not found in outbox body.');
  }
  return match[1];
}

const tempDirectories: string[] = [];

afterEach(async () => {
  delete process.env['CAREERRAFIQ_DB_FILE'];
  delete process.env['CAREERRAFIQ_UPLOADS_DIR'];
  delete process.env['CAREERRAFIQ_INSECURE_DEV_COOKIE'];
  delete process.env['CAREERRAFIQ_WEB_ORIGIN'];
  delete process.env['CAREERRAFIQ_ENABLE_EYE_MODE'];
  delete process.env['CAREERRAFIQ_OPERATOR_EMAILS'];
  delete process.env['CAREERRAFIQ_EYE_RETENTION_DAYS'];
  delete process.env['CAREERRAFIQ_UPLOAD_RATE_LIMIT_MAX'];
  delete process.env['CAREERRAFIQ_UPLOAD_RATE_LIMIT_WINDOW_SECONDS'];
  delete process.env['CAREERRAFIQ_CAPTURE_RATE_LIMIT_MAX'];
  delete process.env['CAREERRAFIQ_CAPTURE_RATE_LIMIT_WINDOW_SECONDS'];
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('API server integration', () => {
  it('returns request ids and supports operator Eye session lifecycle', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'career-rafiq-api-eye-'));
    tempDirectories.push(tempDir);
    process.env['CAREERRAFIQ_DB_FILE'] = join(tempDir, 'career-rafiq.db');
    process.env['CAREERRAFIQ_UPLOADS_DIR'] = join(tempDir, 'uploads');
    process.env['CAREERRAFIQ_INSECURE_DEV_COOKIE'] = '1';
    process.env['CAREERRAFIQ_ENABLE_EYE_MODE'] = '1';
    process.env['CAREERRAFIQ_OPERATOR_EMAILS'] = 'operator@example.com';

    const server = await startServer(process.env['CAREERRAFIQ_DB_FILE']);
    const cookieJar = new CookieJar();

    try {
      const bootstrapForm = new FormData();
      bootstrapForm.append(
        'uploads',
        new File(
          ['Platform engineer. Contact operator@example.com.'],
          'Operator CV.txt',
          { type: 'text/plain' },
        ),
      );

      const bootstrapResponse = await fetch(`${server.baseUrl}/api/setup/bootstrap`, {
        method: 'POST',
        body: bootstrapForm,
      });
      cookieJar.capture(bootstrapResponse);
      expect(bootstrapResponse.headers.get('x-careerrafiq-request-id')).toMatch(/^req_/);

      const currentEyeResponse = await fetch(`${server.baseUrl}/api/ops/eye/current`, cookieJar.apply());
      expect(currentEyeResponse.ok).toBe(true);
      expect(currentEyeResponse.headers.get('x-careerrafiq-request-id')).toMatch(/^req_/);
      const currentEyePayload = (await currentEyeResponse.json()) as { session: null };
      expect(currentEyePayload.session).toBeNull();

      const startEyeResponse = await fetch(
        `${server.baseUrl}/api/ops/eye/sessions`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            label: 'manual-eye-test',
          }),
        }),
      );
      expect(startEyeResponse.ok).toBe(true);
      const startEyePayload = (await startEyeResponse.json()) as { session: { id: string; status: string } };
      expect(startEyePayload.session.id).toMatch(/^eye_/);
      expect(startEyePayload.session.status).toBe('active');

      const eventsResponse = await fetch(
        `${server.baseUrl}/api/ops/eye/events?eyeSessionId=${encodeURIComponent(startEyePayload.session.id)}`,
        cookieJar.apply({
          headers: {
            'x-careerrafiq-eye-session-id': startEyePayload.session.id,
          },
        }),
      );
      expect(eventsResponse.ok).toBe(true);
      const eventsPayload = (await eventsResponse.json()) as { events: Array<{ code: string }> };
      expect(eventsPayload.events.some((event) => event.code === 'eye_session_started')).toBe(true);

      const unauthorizedResponse = await fetch(`${server.baseUrl}/api/tracker`);
      expect(unauthorizedResponse.status).toBe(401);
      expect(unauthorizedResponse.headers.get('x-careerrafiq-request-id')).toMatch(/^req_/);
      const unauthorizedPayload = (await unauthorizedResponse.json()) as { requestId: string };
      expect(unauthorizedPayload.requestId).toMatch(/^req_/);
    } finally {
      await server.close();
    }
  });

  it('bootstraps, verifies, captures, evaluates, and persists tracker state across restart', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'career-rafiq-api-'));
    tempDirectories.push(tempDir);
    process.env['CAREERRAFIQ_DB_FILE'] = join(tempDir, 'career-rafiq.db');
    process.env['CAREERRAFIQ_UPLOADS_DIR'] = join(tempDir, 'uploads');
    process.env['CAREERRAFIQ_INSECURE_DEV_COOKIE'] = '1';

    let firstServer: StartedServer | null = null;
    let secondServer: StartedServer | null = null;

    try {
      firstServer = await startServer(process.env['CAREERRAFIQ_DB_FILE']);
      const cookieJar = new CookieJar();

      const bootstrapForm = new FormData();
      bootstrapForm.append(
        'uploads',
        new File(
          ['Senior Platform Engineer. Python AWS Kubernetes Terraform. Contact backend@example.com'],
          'Platform CV.txt',
          { type: 'text/plain' },
        ),
      );

      const bootstrapResponse = await fetch(`${firstServer.baseUrl}/api/setup/bootstrap`, {
        method: 'POST',
        body: bootstrapForm,
      });
      cookieJar.capture(bootstrapResponse);
      expect(bootstrapResponse.ok).toBe(true);
      const bootstrapPayload = (await bootstrapResponse.json()) as { user: { email: string | null } };
      expect(bootstrapPayload.user.email).toBe('backend@example.com');

      const sessionResponse = await fetch(`${firstServer.baseUrl}/api/auth/session`, cookieJar.apply());
      expect(sessionResponse.ok).toBe(true);
      const sessionPayload = (await sessionResponse.json()) as {
        authenticated: boolean;
        sessionExpiresAt: string | null;
        returnAccessRequiresVerification: boolean;
      };
      expect(sessionPayload.authenticated).toBe(true);
      expect(sessionPayload.sessionExpiresAt).not.toBeNull();
      expect(sessionPayload.returnAccessRequiresVerification).toBe(true);

      const throttledMagicLinkResponse = await fetch(
        `${firstServer.baseUrl}/api/auth/magic-link/request`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ email: 'backend@example.com' }),
        }),
      );
      expect(throttledMagicLinkResponse.status).toBe(500);
      const throttledMagicLinkPayload = (await throttledMagicLinkResponse.json()) as { error: string };
      expect(throttledMagicLinkPayload.error).toMatch(/Please wait/);

      const outboxResponse = await fetch(`${firstServer.baseUrl}/api/dev/email-outbox/latest?email=backend@example.com`);
      const outboxPayload = (await outboxResponse.json()) as { message: { body: string } | null };
      expect(outboxPayload.message).not.toBeNull();
      const token = extractTokenFromOutbox(outboxPayload.message!.body);

      const consumeResponse = await fetch(
        `${firstServer.baseUrl}/api/auth/magic-link/consume?token=${encodeURIComponent(token)}&email=${encodeURIComponent('backend@example.com')}`,
        cookieJar.apply(),
      );
      cookieJar.capture(consumeResponse);
      expect(consumeResponse.ok).toBe(true);
      const consumePayload = (await consumeResponse.json()) as { verified: boolean };
      expect(consumePayload.verified).toBe(true);

      const captureResponse = await fetch(
        `${firstServer.baseUrl}/api/capture/page`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            sourceUrl: 'https://boards.greenhouse.io/acme/jobs/123',
            pageContent: `
              <html>
                <head>
                  <script type="application/ld+json">
                    {
                      "@context":"https://schema.org",
                      "@type":"JobPosting",
                      "title":"Platform Engineer",
                      "description":"<p>Build cloud infrastructure with Python, AWS, Kubernetes, and Terraform.</p>",
                      "employmentType":"FULL_TIME",
                      "hiringOrganization":{"name":"Acme"},
                      "jobLocation":[{"address":{"addressLocality":"Remote","addressCountry":"Worldwide"}}]
                    }
                  </script>
                </head>
                <body><h1>Platform Engineer</h1></body>
              </html>
            `,
          }),
        }),
      );
      expect(captureResponse.ok).toBe(true);
      const capturePayload = (await captureResponse.json()) as { job: { id: string } | null; validation: { status: string } };
      expect(capturePayload.job?.id).toBeTruthy();

      const duplicateCaptureResponse = await fetch(
        `${firstServer.baseUrl}/api/capture/page`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            sourceUrl: 'https://boards.greenhouse.io/acme/jobs/123',
            pageContent: '<html><body><h1>Platform Engineer</h1></body></html>',
          }),
        }),
      );
      const duplicateCapturePayload = (await duplicateCaptureResponse.json()) as { job: { id: string } | null };
      expect(duplicateCapturePayload.job?.id).toBe(capturePayload.job?.id);

      if (capturePayload.validation.status !== 'proceed') {
        const reviewResponse = await fetch(
          `${firstServer.baseUrl}/api/jobs/${capturePayload.job!.id}/review`,
          cookieJar.apply({
            method: 'PATCH',
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
              title: 'Platform Engineer',
              company: 'Acme',
              location: 'Remote',
              workSetup: 'remote',
              employmentType: 'full_time',
              description: 'Build cloud infrastructure with Python, AWS, Kubernetes, and Terraform.',
              recruiterOrPosterSignal: null,
              companySector: 'Software',
              companyType: 'Startup',
              keywords: ['python', 'aws', 'kubernetes', 'terraform'],
            }),
          }),
        );
        expect(reviewResponse.ok).toBe(true);
      }

      const evaluateResponse = await fetch(
        `${firstServer.baseUrl}/api/jobs/${capturePayload.job!.id}/evaluate`,
        cookieJar.apply({
          method: 'POST',
        }),
      );
      expect(evaluateResponse.ok).toBe(true);
      const evaluatePayload = (await evaluateResponse.json()) as { evaluation: { verdict: string | null } };
      expect(evaluatePayload.evaluation.verdict).toBe('apply');

      const trackerResponse = await fetch(`${firstServer.baseUrl}/api/tracker`, cookieJar.apply());
      const trackerPayload = (await trackerResponse.json()) as { items: unknown[] };
      expect(trackerPayload.items).toHaveLength(1);

      const opsResponse = await fetch(`${firstServer.baseUrl}/api/ops/summary`, cookieJar.apply());
      expect(opsResponse.ok).toBe(true);
      const opsPayload = (await opsResponse.json()) as {
        summary: {
          user: { email: string | null };
          tracker: { totalItems: number };
          email: { currentAddress: string | null };
        };
      };
      expect(opsPayload.summary.user.email).toBe('backend@example.com');
      expect(opsPayload.summary.tracker.totalItems).toBe(1);
      expect(opsPayload.summary.email.currentAddress).toBe('backend@example.com');

      const readyResponse = await fetch(`${firstServer.baseUrl}/api/ready`, cookieJar.apply());
      expect(readyResponse.ok).toBe(true);
      const readyPayload = (await readyResponse.json()) as { ok: boolean; checks: { databaseReady: boolean; webBundleReady: boolean } };
      expect(readyPayload.ok).toBe(true);
      expect(readyPayload.checks.databaseReady).toBe(true);
      expect(readyPayload.checks.webBundleReady).toBe(true);

      const analyticsEventsToTrack = [
        'setup_review_opened',
        'tracker_opened',
        'tracked_job_opened',
        'details_view_opened',
        'verdict_shown',
        'recommended_cv_shown',
      ] as const;

      for (const eventName of analyticsEventsToTrack) {
        const analyticsResponse = await fetch(
          `${firstServer.baseUrl}/api/analytics`,
          cookieJar.apply({
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
              name: eventName,
              properties: {
                jobId: capturePayload.job!.id,
              },
            }),
          }),
        );
        expect(analyticsResponse.ok).toBe(true);
      }

      const statusResponse = await fetch(
        `${firstServer.baseUrl}/api/tracker/${capturePayload.job!.id}/status`,
        cookieJar.apply({
          method: 'PATCH',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            status: 'applied',
          }),
        }),
      );
      expect(statusResponse.ok).toBe(true);

      const verdictDecisionResponse = await fetch(
        `${firstServer.baseUrl}/api/tracker/${capturePayload.job!.id}/verdict`,
        cookieJar.apply({
          method: 'PATCH',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            decision: 'followed',
          }),
        }),
      );
      expect(verdictDecisionResponse.ok).toBe(true);

      const reevaluateResponse = await fetch(
        `${firstServer.baseUrl}/api/jobs/${capturePayload.job!.id}/evaluate`,
        cookieJar.apply({
          method: 'POST',
        }),
      );
      expect(reevaluateResponse.ok).toBe(true);

      await firstServer.close();
      firstServer = null;

      secondServer = await startServer(process.env['CAREERRAFIQ_DB_FILE']);
      const restoredSessionResponse = await fetch(`${secondServer.baseUrl}/api/auth/session`, cookieJar.apply());
      const restoredSessionPayload = (await restoredSessionResponse.json()) as { authenticated: boolean };
      expect(restoredSessionPayload.authenticated).toBe(true);

      const restoredTrackerResponse = await fetch(`${secondServer.baseUrl}/api/tracker`, cookieJar.apply());
      const restoredTrackerPayload = (await restoredTrackerResponse.json()) as { items: unknown[] };
      expect(restoredTrackerPayload.items).toHaveLength(1);

      await secondServer.close();
      secondServer = null;

      const repository = CareerRafiqRepository.open(process.env['CAREERRAFIQ_DB_FILE']);
      const eventNames = repository.listAnalyticsEvents().map((event) => event.name);
      repository.close();

      expect(eventNames).toEqual(expect.arrayContaining([
        'cv_upload_started',
        'cv_upload_completed',
        'cv_profile_generated',
        'email_extracted',
        'setup_minimum_ready',
        'magic_link_sent',
        'email_verified',
        'job_capture_started',
        'evaluation_started',
        'evaluation_completed',
        'reevaluation_requested',
        'reevaluation_completed',
        'setup_review_opened',
        'tracker_opened',
        'tracked_job_opened',
        'details_view_opened',
        'verdict_shown',
        'recommended_cv_shown',
        'status_changed',
        'verdict_followed',
      ]));
      expect(eventNames.some((name) => name === 'job_capture_succeeded' || name === 'job_review_required')).toBe(true);
      expect(eventNames.some((name) => name === 'job_review_confirmed' || name === 'job_capture_succeeded')).toBe(true);
    } finally {
      if (firstServer) {
        await firstServer.close();
      }
      if (secondServer) {
        await secondServer.close();
      }
    }
  });

  it('requires a valid CSRF token for authenticated browser-origin mutations', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'career-rafiq-api-csrf-'));
    tempDirectories.push(tempDir);
    process.env['CAREERRAFIQ_DB_FILE'] = join(tempDir, 'career-rafiq.db');
    process.env['CAREERRAFIQ_UPLOADS_DIR'] = join(tempDir, 'uploads');
    process.env['CAREERRAFIQ_INSECURE_DEV_COOKIE'] = '1';
    process.env['CAREERRAFIQ_WEB_ORIGIN'] = 'http://localhost:3000';

    let server: StartedServer | null = null;

    try {
      server = await startServer(process.env['CAREERRAFIQ_DB_FILE']);
      const cookieJar = new CookieJar();

      const bootstrapForm = new FormData();
      bootstrapForm.append(
        'uploads',
        new File(
          ['Platform engineer. backend@example.com'],
          'Platform CV.txt',
          { type: 'text/plain' },
        ),
      );

      const bootstrapResponse = await fetch(`${server.baseUrl}/api/setup/bootstrap`, {
        method: 'POST',
        body: bootstrapForm,
      });
      cookieJar.capture(bootstrapResponse);
      expect(bootstrapResponse.ok).toBe(true);

      const missingCsrfResponse = await fetch(
        `${server.baseUrl}/api/analytics`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            name: 'tracker_opened',
          }),
        }),
      );
      expect(missingCsrfResponse.status).toBe(403);

      const csrfToken = cookieJar.get('career_rafiq_csrf');
      expect(csrfToken).toBeTruthy();

      const validCsrfResponse = await fetch(
        `${server.baseUrl}/api/analytics`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json; charset=utf-8',
            'x-careerrafiq-csrf': csrfToken!,
          },
          body: JSON.stringify({
            name: 'tracker_opened',
          }),
        }),
      );
      expect(validCsrfResponse.ok).toBe(true);
    } finally {
      if (server) {
        await server.close();
      }
    }
  });

  it('uses lax cookies for local insecure development so browsers accept the session on localhost', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'career-rafiq-api-cookie-policy-'));
    tempDirectories.push(tempDir);
    process.env['CAREERRAFIQ_DB_FILE'] = join(tempDir, 'career-rafiq.db');
    process.env['CAREERRAFIQ_UPLOADS_DIR'] = join(tempDir, 'uploads');
    process.env['CAREERRAFIQ_INSECURE_DEV_COOKIE'] = '1';

    let server: StartedServer | null = null;

    try {
      server = await startServer(process.env['CAREERRAFIQ_DB_FILE']);
      const response = await fetch(`${server.baseUrl}/api/auth/session`);
      expect(response.ok).toBe(true);

      const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
      const cookieLines = typeof getSetCookie === 'function'
        ? getSetCookie.call(response.headers)
        : (response.headers.get('set-cookie')
            ? response.headers.get('set-cookie')!.split(/,(?=[^;,\s]+=)/g)
            : []);

      expect(cookieLines.some((cookieLine) => cookieLine.includes('SameSite=Lax'))).toBe(true);
      expect(cookieLines.some((cookieLine) => cookieLine.includes('SameSite=None'))).toBe(false);
      expect(cookieLines.some((cookieLine) => cookieLine.includes('Secure'))).toBe(false);
    } finally {
      if (server) {
        await server.close();
      }
    }
  });

  it('rate limits repeated capture requests when the capture window is exceeded', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'career-rafiq-api-rate-limit-'));
    tempDirectories.push(tempDir);
    process.env['CAREERRAFIQ_DB_FILE'] = join(tempDir, 'career-rafiq.db');
    process.env['CAREERRAFIQ_UPLOADS_DIR'] = join(tempDir, 'uploads');
    process.env['CAREERRAFIQ_INSECURE_DEV_COOKIE'] = '1';
    process.env['CAREERRAFIQ_CAPTURE_RATE_LIMIT_MAX'] = '1';
    process.env['CAREERRAFIQ_CAPTURE_RATE_LIMIT_WINDOW_SECONDS'] = '60';

    let server: StartedServer | null = null;

    try {
      server = await startServer(process.env['CAREERRAFIQ_DB_FILE']);
      const cookieJar = new CookieJar();

      const bootstrapForm = new FormData();
      bootstrapForm.append(
        'uploads',
        new File(
          ['Platform engineer. backend@example.com'],
          'Platform CV.txt',
          { type: 'text/plain' },
        ),
      );

      const bootstrapResponse = await fetch(`${server.baseUrl}/api/setup/bootstrap`, {
        method: 'POST',
        body: bootstrapForm,
      });
      cookieJar.capture(bootstrapResponse);
      expect(bootstrapResponse.ok).toBe(true);

      const firstCaptureResponse = await fetch(
        `${server.baseUrl}/api/capture/manual`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            sourceIdentifier: 'manual',
            title: 'Platform Engineer',
            company: 'Acme',
            location: 'Remote',
            workSetup: 'remote',
            employmentType: 'full_time',
            description: 'Build cloud infrastructure with Python and Kubernetes.',
            recruiterOrPosterSignal: null,
            companySector: 'Software',
            companyType: 'Startup',
            keywords: ['python', 'kubernetes'],
          }),
        }),
      );
      expect(firstCaptureResponse.ok).toBe(true);

      const secondCaptureResponse = await fetch(
        `${server.baseUrl}/api/capture/manual`,
        cookieJar.apply({
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            sourceIdentifier: 'manual',
            title: 'Platform Engineer II',
            company: 'Acme',
            location: 'Remote',
            workSetup: 'remote',
            employmentType: 'full_time',
            description: 'Build cloud infrastructure with Terraform and AWS.',
            recruiterOrPosterSignal: null,
            companySector: 'Software',
            companyType: 'Startup',
            keywords: ['terraform', 'aws'],
          }),
        }),
      );
      expect(secondCaptureResponse.status).toBe(429);
      expect(secondCaptureResponse.headers.get('retry-after')).toBeTruthy();
    } finally {
      if (server) {
        await server.close();
      }
    }
  });
});
