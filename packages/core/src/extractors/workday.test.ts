import { describe, expect, it } from 'vitest';
import { extractWorkdayPayload } from './workday.js';

describe('extractWorkdayPayload', () => {
  it('extracts structured fields from common Workday markup', () => {
    const payload = extractWorkdayPayload({
      sourceUrl: 'https://company.wd5.myworkdayjobs.com/en-US/External/job/123',
      pageHtml: `
        <html>
          <body>
            <h1 data-automation-id="jobPostingHeader">Platform Engineer</h1>
            <div data-automation-id="companyName">Example Systems</div>
            <div data-automation-id="locations">Cairo, Egypt</div>
            <div data-automation-id="jobPostingDescription">
              Build Kubernetes platform tooling using TypeScript and AWS.
            </div>
          </body>
        </html>
      `,
    });

    expect(payload.sourceIdentifier).toBe('workday');
    expect(payload.extractionCandidate.title).toBe('Platform Engineer');
    expect(payload.extractionCandidate.company).toBe('Example Systems');
    expect(payload.extractionCandidate.location).toContain('Cairo');
    expect(payload.extractionCandidate.description).toContain('Kubernetes');
    expect(payload.sourceConfidenceHints).toContain('workday_variant_detected');
  });

  it('uses JSON-LD job posting data when present', () => {
    const payload = extractWorkdayPayload({
      sourceUrl: 'https://company.wd3.myworkdayjobs.com/job/456',
      pageHtml: `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "JobPosting",
                "title": "Senior Data Engineer",
                "description": "Own ETL and dbt pipelines.",
                "hiringOrganization": { "name": "Data Org" }
              }
            </script>
          </head>
          <body>
            <div data-automation-id="locations">Remote</div>
          </body>
        </html>
      `,
    });

    expect(payload.extractionCandidate.title).toBe('Senior Data Engineer');
    expect(payload.extractionCandidate.company).toBe('Data Org');
    expect(payload.extractionCandidate.description).toContain('ETL');
  });

  it('surfaces missing-field ambiguity explicitly', () => {
    const payload = extractWorkdayPayload({
      sourceUrl: 'https://company.wd3.myworkdayjobs.com/job/789',
      pageHtml: `<html><body><h1>Unknown Posting</h1></body></html>`,
    });

    expect(payload.ambiguityFlags).toContain('missing_description');
    expect(payload.ambiguityFlags).toContain('incomplete_primary_fields');
  });
});

