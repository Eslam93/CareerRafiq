import { describe, expect, it } from 'vitest';
import { CareerRafiqCore } from './index.js';

function createBackendCapture() {
  return {
    extraction: {
      sourceIdentifier: 'greenhouse' as const,
      sourceUrl: 'https://example.com/jobs/backend',
      rawCaptureContent: 'Backend Engineer at Example Co',
      extractionCandidate: {
        title: 'Backend Engineer',
        company: 'Example Co',
        location: 'Remote',
        workSetup: 'remote' as const,
        employmentType: 'full_time' as const,
        description: 'Build APIs with Python and FastAPI on AWS.',
        recruiterOrPosterSignal: null,
        companySector: 'Software',
        companyType: 'Startup',
        keywords: ['Python', 'FastAPI', 'AWS'],
      },
      sourceConfidenceHints: [],
      ambiguityFlags: [],
      extractionNotes: [],
    },
  };
}

describe('CareerRafiqCore', () => {
  it('bootstraps, captures, and evaluates a strong backend fit', () => {
    const core = new CareerRafiqCore();
    const bootstrap = core.bootstrap({
      uploads: [
        {
          fileName: 'Backend CV.pdf',
          rawText: 'Senior Backend Engineer. Python FastAPI AWS PostgreSQL. Contact backend@example.com',
        },
      ],
    });

    expect(bootstrap.minimumUsableDataReady).toBe(true);

    const capture = core.captureJob(createBackendCapture());
    expect(capture.job?.jobExtractionState).toBe('ready_for_evaluation');

    const evaluation = core.evaluateJob({ jobId: capture.job!.id });
    expect(evaluation.evaluation.verdict).toBe('apply');
    expect(evaluation.evaluation.recommendedCvId).toBe(bootstrap.cvs[0]?.id);
    expect(evaluation.trackerItem?.activeEvaluationId).toBe(evaluation.evaluation.id);
  });

  it('returns a review-required result when extraction is incomplete', () => {
    const core = new CareerRafiqCore();
    core.bootstrap({
      uploads: [
        {
          fileName: 'General CV.pdf',
          rawText: 'Software engineer with broad backend experience.',
        },
      ],
    });

    const capture = core.captureJob({
      extraction: {
        sourceIdentifier: 'greenhouse',
        sourceUrl: 'https://example.com/jobs/incomplete',
        rawCaptureContent: 'Incomplete job',
        extractionCandidate: {
          title: 'Backend Engineer',
          company: 'Example Co',
          location: null,
          workSetup: 'unknown',
          employmentType: 'unknown',
          description: '',
          recruiterOrPosterSignal: null,
          companySector: null,
          companyType: null,
          keywords: [],
        },
        sourceConfidenceHints: [],
        ambiguityFlags: ['missing-description'],
        extractionNotes: [],
      },
    });

    expect(capture.validation.status).toBe('review_required');

    const evaluation = core.evaluateJob({ jobId: capture.job!.id });
    expect(evaluation.evaluation.reviewGateStatus).toBe('review_required');
    expect(evaluation.evaluation.verdict).toBeNull();
  });

  it('extracts and captures a supported page through the source registry', () => {
    const core = new CareerRafiqCore();
    core.bootstrap({
      uploads: [
        {
          fileName: 'Platform CV.pdf',
          rawText: 'Senior Platform Engineer with Python, AWS, Kubernetes, and Terraform. platform@example.com',
        },
      ],
    });

    const capture = core.capturePage({
      sourceUrl: 'https://boards.greenhouse.io/acme/jobs/123',
      pageContent: `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context":"https://schema.org",
                "@type":"JobPosting",
                "title":"Platform Engineer",
                "description":"<p>Build cloud infrastructure with Python, AWS, Kubernetes, and Terraform. Own platform reliability, automate incident response, improve observability and deployment safety, and partner with application teams on production readiness, security controls, and performance engineering across distributed services.</p>",
                "employmentType":"FULL_TIME",
                "hiringOrganization":{"name":"Acme"},
                "jobLocation":[{"address":{"addressLocality":"Remote","addressCountry":"Worldwide"}}]
              }
            </script>
          </head>
          <body><h1>Platform Engineer</h1></body>
        </html>
      `,
    });

    expect(capture.supported).toBe(true);
    expect(capture.detectedSourceIdentifier).toBe('greenhouse');
    expect(capture.validation.status).not.toBe('failed');
    expect(capture.job?.normalizedJobObject.title).toBe('Platform Engineer');
  });

  it('enforces the daily evaluation limit only after verification', () => {
    const core = new CareerRafiqCore({ dailyEvaluationLimit: 1 });
    const bootstrap = core.bootstrap({
      uploads: [
        {
          fileName: 'Backend CV.pdf',
          rawText: 'Senior Backend Engineer. Python FastAPI AWS PostgreSQL. Contact backend@example.com',
        },
      ],
    });

    const verification = core.verifyMagicLink({
      token: bootstrap.magicLinkToken!,
      email: bootstrap.user.email!,
    });

    expect(verification.verified).toBe(true);

    const capture = core.captureJob(createBackendCapture());
    const firstEvaluation = core.evaluateJob({ jobId: capture.job!.id });
    expect(firstEvaluation.evaluation.verdict).toBe('apply');
    expect(() => core.evaluateJob({ jobId: capture.job!.id })).toThrow(/Daily evaluation limit reached/);
  });

  it('round-trips persisted core state and exposes tracker detail queries', () => {
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
    const capture = core.captureJob(createBackendCapture());
    const evaluation = core.evaluateJob({ jobId: capture.job!.id });

    const restored = new CareerRafiqCore();
    restored.importState(core.exportState());

    expect(restored.getBootstrapState().bootstrap?.user.id).toBe(bootstrap.user.id);
    expect(restored.listTrackerItems().items).toHaveLength(1);
    expect(restored.getTrackerDetail(capture.job!.id).evaluation?.id).toBe(evaluation.evaluation.id);
    expect(restored.getTrackerItem(capture.job!.id)?.jobId).toBe(capture.job!.id);
  });
});
