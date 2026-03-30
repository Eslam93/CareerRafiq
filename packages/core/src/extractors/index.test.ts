import { describe, expect, it } from 'vitest';
import { detectSourceIdentifierFromUrl, extractPagePayload, isSourceSupported } from './index.js';

describe('extractor registry', () => {
  it('detects known source identifiers from URLs', () => {
    expect(detectSourceIdentifierFromUrl('https://boards.greenhouse.io/acme/jobs/123')).toBe('greenhouse');
    expect(detectSourceIdentifierFromUrl('https://www.linkedin.com/jobs/view/123')).toBe('linkedin');
    expect(detectSourceIdentifierFromUrl('https://jobs.lever.co/acme/123')).toBe('lever');
    expect(detectSourceIdentifierFromUrl('https://example.com/jobs/123')).toBe('unsupported');
  });

  it('routes extraction to supported source handlers', () => {
    const payload = extractPagePayload({
      sourceUrl: 'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123',
      pageContent: '<html><body>Workday Job</body></html>',
    });

    expect(payload.sourceIdentifier).toBe('workday');
    expect(isSourceSupported(payload.sourceIdentifier)).toBe(true);
  });
});
