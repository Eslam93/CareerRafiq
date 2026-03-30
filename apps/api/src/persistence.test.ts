import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CareerRafiqCore } from '@career-rafiq/core';
import { loadApiCoreFromFile, saveApiCoreToFile } from './persistence.js';

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe('API persistence', () => {
  it('round-trips persisted core state to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'career-rafiq-api-'));
    tempPaths.push(dir);
    const filePath = join(dir, 'state.json');

    const core = new CareerRafiqCore();
    const bootstrap = core.bootstrap({
      uploads: [
        {
          fileName: 'Backend CV.pdf',
          rawText: 'Senior Backend Engineer. Python FastAPI AWS PostgreSQL. Contact backend@example.com',
        },
      ],
    });
    core.verifyMagicLink({
      token: bootstrap.magicLinkToken!,
      email: bootstrap.user.email!,
    });
    const capture = core.captureJob({
      extraction: {
        sourceIdentifier: 'greenhouse',
        sourceUrl: 'https://boards.greenhouse.io/acme/jobs/123',
        rawCaptureContent: 'Platform Engineer',
        extractionCandidate: {
          title: 'Platform Engineer',
          company: 'Acme',
          location: 'Remote',
          workSetup: 'remote',
          employmentType: 'full_time',
          description: 'Build cloud systems with Python, AWS, and Kubernetes.',
          recruiterOrPosterSignal: null,
          companySector: null,
          companyType: null,
          keywords: ['python', 'aws', 'kubernetes'],
        },
        sourceConfidenceHints: [],
        ambiguityFlags: [],
        extractionNotes: [],
      },
    });
    core.evaluateJob({ jobId: capture.job!.id });

    await saveApiCoreToFile(core, filePath);
    const restored = await loadApiCoreFromFile(filePath);

    expect(restored.getBootstrapState().bootstrap?.user.id).toBe(bootstrap.user.id);
    expect(restored.listTrackerItems().items).toHaveLength(1);
    expect(restored.getTrackerDetail(capture.job!.id).job?.id).toBe(capture.job!.id);
  });
});
