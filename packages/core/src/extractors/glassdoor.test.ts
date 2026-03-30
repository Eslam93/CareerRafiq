import { describe, expect, it } from 'vitest';
import { extractGlassdoorPayload } from './glassdoor.js';

describe('extractGlassdoorPayload', () => {
  it('extracts visible primary job fields', () => {
    const payload = extractGlassdoorPayload({
      sourceUrl: 'https://www.glassdoor.com/job-listing/example',
      pageHtml: `
        <html>
          <body>
            <h1 data-test="job-title">Senior Platform Engineer</h1>
            <div data-test="employer-name">Example Corp</div>
            <div data-test="location">Dubai, UAE</div>
            <div data-test="job-description">
              Build secure cloud infrastructure with Kubernetes and Terraform.
            </div>
          </body>
        </html>
      `,
    });

    expect(payload.sourceIdentifier).toBe('glassdoor');
    expect(payload.extractionCandidate.title).toBe('Senior Platform Engineer');
    expect(payload.extractionCandidate.company).toBe('Example Corp');
    expect(payload.extractionCandidate.location).toContain('Dubai');
    expect(payload.extractionCandidate.description).toContain('Kubernetes');
  });

  it('trims surrounding noise and flags contamination ambiguity', () => {
    const payload = extractGlassdoorPayload({
      sourceUrl: 'https://www.glassdoor.com/job-listing/noisy',
      pageHtml: `
        <html>
          <body>
            <h1 data-test="job-title">Backend Engineer</h1>
            <div data-test="employer-name">Example Co</div>
            <div data-test="job-description">
              Build APIs for payment services.
              Similar Jobs
              Related listing content
            </div>
            <a data-test="job-link">job-1</a>
            <a data-test="job-link">job-2</a>
          </body>
        </html>
      `,
    });

    expect(payload.extractionCandidate.description).not.toContain('Similar Jobs');
    expect(payload.ambiguityFlags).toContain('description_contamination_risk');
    expect(payload.ambiguityFlags).toContain('multiple_visible_job_cards');
  });

  it('surfaces low-confidence ambiguity when required fields are missing', () => {
    const payload = extractGlassdoorPayload({
      sourceUrl: 'https://www.glassdoor.com/job-listing/missing',
      pageHtml: `<html><body><h1 data-test="job-title">Role Only</h1></body></html>`,
    });

    expect(payload.ambiguityFlags).toContain('missing_description');
    expect(payload.ambiguityFlags).toContain('incomplete_primary_fields');
  });
});

