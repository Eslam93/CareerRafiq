import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CareerRafiqRepository } from '@career-rafiq/db';
import { CareerRafiqApiService } from './service.js';
import type { EmailDeliveryService } from './email.js';
import type { ParsedMultipartUpload } from './uploads.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  delete process.env['CAREERRAFIQ_MAGIC_LINK_THROTTLE_SECONDS'];
  delete process.env['CAREERRAFIQ_DEV_AUTO_VERIFY_MAGIC_LINK'];
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function buildUpload(fileName: string, text: string, mimeType = 'text/plain'): ParsedMultipartUpload {
  return {
    fieldName: 'uploads',
    fileName,
    mimeType,
    buffer: Buffer.from(text, 'utf8'),
  };
}

function extractTokenFromOutbox(body: string): string {
  const match = body.match(/token=([^&]+)&email=/);
  if (!match?.[1]) {
    throw new Error('Magic-link token not found in outbox body.');
  }
  return match[1];
}

async function createService(now: Date): Promise<{
  clock: { now: Date };
  service: CareerRafiqApiService;
}> {
  return createServiceWithOptions(now);
}

async function createServiceWithOptions(
  now: Date,
  options: {
    emailDeliveryService?: EmailDeliveryService;
  } = {},
): Promise<{
  clock: { now: Date };
  service: CareerRafiqApiService;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'career-rafiq-service-'));
  tempDirectories.push(tempDir);
  const clock = { now };
  const repository = CareerRafiqRepository.open(join(tempDir, 'career-rafiq.db'));
  const service = new CareerRafiqApiService({
    repository,
    clock: () => clock.now,
    ...options,
  });
  return { clock, service };
}

describe('CareerRafiqApiService', () => {
  it('flags no-email bootstrap as temporary access requiring verification', async () => {
    const { clock, service } = await createService(new Date('2026-03-01T10:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload('No Email CV.txt', 'Senior frontend engineer with React, TypeScript, and design systems.'),
      ]);

      expect(bootstrap.user.accountStatus).toBe('temporary');
      expect(bootstrap.emailCollectionRequired).toBe(true);
      expect(bootstrap.returnAccessRequiresVerification).toBe(true);
      expect(bootstrap.selectedEmailCandidate).toBeNull();
      expect(bootstrap.detectedEmails).toEqual([]);

      const session = service.getAuthSession(bootstrap.sessionToken);
      expect(session.authenticated).toBe(true);
      expect(session.sessionExpiresAt).not.toBeNull();
      expect(session.emailCollectionRequired).toBe(true);

      clock.now = new Date('2026-03-02T11:30:00.000Z');
      expect(service.getAuthSession(bootstrap.sessionToken).authenticated).toBe(false);
    } finally {
      service.close();
    }
  });

  it('surfaces email conflicts and requires verification for return access until the magic link is consumed', async () => {
    const { service } = await createService(new Date('2026-03-05T09:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload(
          'Conflicted CV.txt',
          'Reach me at primary@example.com. Alternate contact alternate@example.com. Platform engineer with AWS.',
        ),
      ]);

      expect(bootstrap.user.accountStatus).toBe('unverified');
      expect(bootstrap.emailConflictDetected).toBe(true);
      expect(bootstrap.selectedEmailCandidate).toBe('primary@example.com');
      expect(bootstrap.returnAccessRequiresVerification).toBe(true);

      const outbox = service.getLatestDevOutbox('primary@example.com');
      expect(outbox).not.toBeNull();
      const consumed = service.consumeMagicLink(extractTokenFromOutbox(outbox!.body), 'primary@example.com');

      expect(consumed.verified).toBe(true);
      expect(consumed.accessLevel).toBe('verified');
      expect(consumed.user?.accountStatus).toBe('verified');
      expect(service.getAuthSession(consumed.sessionToken).returnAccessRequiresVerification).toBe(false);
    } finally {
      service.close();
    }
  });

  it('supports additional CV uploads and default CV selection after setup', async () => {
    const { service } = await createService(new Date('2026-03-07T08:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload('Backend CV.txt', 'backend@example.com Senior backend engineer with Node.js and PostgreSQL.'),
      ]);

      const uploaded = await service.uploadAdditionalCvs(bootstrap.user.id, [
        buildUpload('Platform CV.txt', 'Staff platform engineer with Kubernetes, Terraform, and AWS.'),
      ]);

      expect(uploaded.addedCvIds).toHaveLength(1);
      expect(uploaded.bootstrap.cvs).toHaveLength(2);
      expect(uploaded.bootstrap.cvProfiles.length).toBeGreaterThanOrEqual(2);

      const newDefaultCvId = uploaded.bootstrap.cvProfiles.find((profile) => profile.cvName === 'Platform CV.txt')?.cvId;
      expect(newDefaultCvId).toBeTruthy();

      const updated = service.setDefaultCv(bootstrap.user.id, newDefaultCvId!, false);
      expect(updated.user.defaultCvId).toBe(newDefaultCvId);
      expect(updated.bootstrap?.user.defaultCvId).toBe(newDefaultCvId);
    } finally {
      service.close();
    }
  });

  it('auto-verifies extracted email locally when the dev auto-verify shortcut is enabled', async () => {
    process.env['CAREERRAFIQ_DEV_AUTO_VERIFY_MAGIC_LINK'] = '1';
    const { service } = await createService(new Date('2026-03-07T08:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload('Backend CV.txt', 'backend@example.com Senior backend engineer with Node.js and PostgreSQL.'),
      ]);

      expect(bootstrap.user.accountStatus).toBe('verified');
      expect(bootstrap.user.emailVerificationStatus).toBe('verified');
      expect(bootstrap.returnAccessRequiresVerification).toBe(false);
      expect(bootstrap.emailCollectionRequired).toBe(false);

      const session = service.getAuthSession(bootstrap.sessionToken);
      expect(session.authenticated).toBe(true);
      expect(session.accessLevel).toBe('verified');
      expect(session.returnAccessRequiresVerification).toBe(false);
    } finally {
      service.close();
    }
  });

  it('rejects unsupported binary CV uploads before parsing begins', async () => {
    const { service } = await createService(new Date('2026-03-08T08:00:00.000Z'));

    try {
      await expect(
        service.bootstrapFromUploads([
          buildUpload('Legacy CV.doc', 'binary', 'application/msword'),
        ]),
      ).rejects.toThrow(/Unsupported CV file type/);
    } finally {
      service.close();
    }
  });

  it('keeps accepted resumes while rejecting non-CV files during bootstrap', async () => {
    const { service } = await createService(new Date('2026-03-08T12:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js and PostgreSQL. Education. Skills.',
        ),
        buildUpload(
          'Job Description.txt',
          'Job description for a backend engineer. This job description includes responsibilities, offer letter language, and company requirements.',
        ),
      ]);

      expect(bootstrap.cvs).toHaveLength(1);
      expect(bootstrap.cvProfiles).toHaveLength(1);
      expect(bootstrap.uploadResults).toHaveLength(2);
      expect(bootstrap.uploadResults.find((item) => item.fileName === 'Backend CV.txt')?.status).toBe('accepted');
      expect(bootstrap.uploadResults.find((item) => item.fileName === 'Job Description.txt')?.status).toBe('rejected_non_cv');
      expect(bootstrap.setupWarnings.some((warning) => warning.includes('Job Description.txt was rejected as a non-CV file'))).toBe(true);
    } finally {
      service.close();
    }
  });

  it('keeps onboarding usable but records failed email delivery when the transport is broken', async () => {
    const failingDelivery: EmailDeliveryService = {
      async send() {
        return {
          status: 'failed',
          provider: 'smtp',
          sentAt: null,
          lastAttemptAt: '2026-03-09T08:00:00.000Z',
          messageId: null,
          errorMessage: 'SMTP connection failed',
        };
      },
      isConfigured() {
        return true;
      },
    };
    const { service } = await createServiceWithOptions(new Date('2026-03-09T08:00:00.000Z'), {
      emailDeliveryService: failingDelivery,
    });

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload('Backend CV.txt', 'backend@example.com Senior backend engineer with Node.js and PostgreSQL.'),
      ]);

      expect(bootstrap.minimumUsableDataReady).toBe(true);
      expect(bootstrap.setupWarnings.some((warning) => warning.includes('Magic-link delivery failed'))).toBe(true);
      expect(service.getLatestDevOutbox('backend@example.com')?.deliveryStatus).toBe('failed');
    } finally {
      service.close();
    }
  });

  it('returns resolution_required when an uploaded CV strongly matches an existing CV', async () => {
    const { service } = await createService(new Date('2026-03-09T12:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js, PostgreSQL, and AWS. Education. Skills.',
        ),
      ]);

      const analysis = await service.analyzeCvUploads(bootstrap.user.id, [
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js, PostgreSQL, and AWS. Education. Skills.',
        ),
      ]);

      expect(analysis.items).toHaveLength(1);
      expect(analysis.items[0]?.status).toBe('resolution_required');
      expect(analysis.items[0]?.candidateMatches[0]?.candidateCvId).toBe(bootstrap.cvs[0]?.id);
      expect(analysis.items[0]?.candidateMatches.some((candidate) => ['exact_content', 'exact_title'].includes(candidate.matchType))).toBe(true);
    } finally {
      service.close();
    }
  });

  it('throttles repeated magic-link requests for the same email address', async () => {
    process.env['CAREERRAFIQ_MAGIC_LINK_THROTTLE_SECONDS'] = '120';
    const { clock, service } = await createService(new Date('2026-03-10T08:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload('Backend CV.txt', 'backend@example.com Senior backend engineer with Node.js and PostgreSQL.'),
      ]);
      const context = service.getSessionContext(bootstrap.sessionToken);

      await expect(service.requestMagicLink(context, { email: 'backend@example.com' })).rejects.toThrow(
        /Please wait 120 seconds before requesting another magic link/,
      );

      clock.now = new Date('2026-03-10T08:02:01.000Z');
      const response = await service.requestMagicLink(context, { email: 'backend@example.com' });

      expect(response.sentTo).toBe('backend@example.com');
      expect(service.getLatestDevOutbox('backend@example.com')?.deliveryStatus).toBe('dev_outbox');
    } finally {
      service.close();
    }
  });

  it('updates an existing CV in place, preserves profile identity, stores a new version, and reevaluates tracked jobs', async () => {
    const { service } = await createService(new Date('2026-03-10T12:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js and PostgreSQL. Education. Skills.',
        ),
      ]);

      const originalCvId = bootstrap.cvs[0]!.id;
      const originalProfileId = bootstrap.cvProfiles[0]!.id;

      const captured = await service.captureManual(bootstrap.user.id, {
        sourceIdentifier: 'manual',
        sourceUrl: 'https://example.com/jobs/backend-update',
        title: 'Backend Engineer',
        company: 'Acme',
        location: 'Remote',
        workSetup: 'remote',
        employmentType: 'full_time',
        description: 'Build backend systems with Node.js, PostgreSQL, and cloud infrastructure.',
        recruiterOrPosterSignal: null,
        companySector: null,
        companyType: null,
        keywords: ['node.js', 'postgresql'],
      });

      await service.evaluateJob(bootstrap.user.id, captured.job!.id);

      const analysis = await service.analyzeCvUploads(bootstrap.user.id, [
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js, PostgreSQL, AWS, and Kubernetes. Education. Skills.',
        ),
      ]);

      const commit = await service.commitCvUploads(bootstrap.user.id, [
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js, PostgreSQL, AWS, and Kubernetes. Education. Skills.',
        ),
      ], [
        {
          uploadToken: analysis.items[0]!.uploadToken,
          decision: 'update_existing',
          targetCvId: originalCvId,
        },
      ]);

      const cvDetail = service.getCvDetail(bootstrap.user.id, originalCvId);

      expect(commit.items).toHaveLength(1);
      expect(commit.items[0]?.status).toBe('updated_existing');
      expect(commit.items[0]?.cvId).toBe(originalCvId);
      expect(commit.bootstrap.cvs).toHaveLength(1);
      expect(cvDetail.cv.id).toBe(originalCvId);
      expect(cvDetail.cv.rawText).toContain('Kubernetes');
      expect(cvDetail.cvProfile?.id).toBe(originalProfileId);
      expect(cvDetail.versions).toHaveLength(2);
      expect(cvDetail.versions.some((version) => version.supersededAt !== null)).toBe(true);
      expect(commit.reevaluatedJobIds).toContain(captured.job!.id);
    } finally {
      service.close();
    }
  });

  it('creates a second CV when the user explicitly chooses create_new for a matched upload', async () => {
    const { service } = await createService(new Date('2026-03-10T15:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js and PostgreSQL. Education. Skills.',
        ),
      ]);

      const analysis = await service.analyzeCvUploads(bootstrap.user.id, [
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js and PostgreSQL. Education. Skills.',
        ),
      ]);

      expect(analysis.items[0]?.status).toBe('resolution_required');

      const commit = await service.commitCvUploads(bootstrap.user.id, [
        buildUpload(
          'Backend CV.txt',
          'Resume. Professional summary. Work experience building backend systems with Node.js and PostgreSQL. Education. Skills.',
        ),
      ], [
        {
          uploadToken: analysis.items[0]!.uploadToken,
          decision: 'create_new',
          targetCvId: null,
        },
      ]);

      const cvList = service.listCvs(bootstrap.user.id);

      expect(commit.items[0]?.status).toBe('created_new');
      expect(commit.items[0]?.cvId).not.toBe(bootstrap.cvs[0]?.id);
      expect(commit.bootstrap.cvs).toHaveLength(2);
      expect(cvList.items).toHaveLength(2);
    } finally {
      service.close();
    }
  });

  it('records user-corrected extraction provenance during manual job review', async () => {
    const { service } = await createService(new Date('2026-03-11T08:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload('Backend CV.txt', 'backend@example.com Senior backend engineer with Node.js and PostgreSQL.'),
      ]);

      const captured = await service.captureManual(bootstrap.user.id, {
        sourceIdentifier: 'manual',
        sourceUrl: 'https://example.com/jobs/backend-platform',
        title: 'Backend Engineer',
        company: 'Acme',
        location: 'Remote',
        workSetup: 'remote',
        employmentType: 'full_time',
        description: 'Build backend systems with Node.js, PostgreSQL, and cloud infrastructure.',
        recruiterOrPosterSignal: null,
        companySector: null,
        companyType: null,
        keywords: ['node.js', 'postgresql'],
      });

      expect(captured.job?.id).toBeTruthy();

      const reviewed = service.updateJobReview(bootstrap.user.id, captured.job!.id, {
        title: 'Senior Backend Engineer',
        company: 'Acme',
        location: 'Remote',
        workSetup: 'remote',
        employmentType: 'full_time',
        description: 'Build backend systems with Node.js, PostgreSQL, AWS, and platform ownership.',
        recruiterOrPosterSignal: 'Hiring manager',
        companySector: 'Software',
        companyType: 'Startup',
        keywords: ['node.js', 'postgresql', 'aws', 'ownership'],
        reevaluateAfterSave: false,
      });

      expect(reviewed.extractionMeta?.mergedFieldProvenance['title']).toBe('user_corrected');
      expect(reviewed.extractionMeta?.mergedFieldProvenance['companySector']).toBe('user_corrected');
      expect(reviewed.extractionMeta?.sourceOfTruthSummary).toMatch(/Manual review corrected/);
      expect(reviewed.extractionMeta?.fieldEvidence.some((entry) => entry.field === 'title' && entry.provenance === 'user_corrected')).toBe(true);
      expect(reviewed.extractionMeta?.history.at(-1)?.note).toMatch(/Manual review changed/);
    } finally {
      service.close();
    }
  });

  it('returns friendly CV names in tracker list responses', async () => {
    const { service } = await createService(new Date('2026-03-12T08:00:00.000Z'));

    try {
      const bootstrap = await service.bootstrapFromUploads([
        buildUpload('Backend CV.txt', 'backend@example.com Senior backend engineer with Node.js and PostgreSQL.'),
      ]);

      const captured = await service.captureManual(bootstrap.user.id, {
        sourceIdentifier: 'manual',
        sourceUrl: 'https://example.com/jobs/backend',
        title: 'Backend Engineer',
        company: 'Acme',
        location: 'Remote',
        workSetup: 'remote',
        employmentType: 'full_time',
        description: 'Build backend systems with Node.js and PostgreSQL.',
        recruiterOrPosterSignal: null,
        companySector: null,
        companyType: null,
        keywords: ['node.js', 'postgresql'],
      });

      await service.evaluateJob(bootstrap.user.id, captured.job!.id);
      const trackerList = service.listTracker(bootstrap.user.id);

      expect(trackerList.items).toHaveLength(1);
      expect(trackerList.items[0]?.recommendedCvName).toBe('Backend CV.txt');
    } finally {
      service.close();
    }
  });
});
