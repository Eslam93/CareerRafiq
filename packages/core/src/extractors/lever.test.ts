import { describe, expect, it } from 'vitest';
import { extractLeverPayload } from './lever.js';

describe('extractLeverPayload', () => {
  it('extracts required Lever fields from common markup', () => {
    const payload = extractLeverPayload({
      sourceUrl: 'https://jobs.lever.co/example/123',
      pageHtml: `
        <html>
          <body>
            <h2 class="posting-headline">Senior Backend Engineer</h2>
            <a class="main-header-logo" aria-label="Example Labs"></a>
            <span class="sort-by-location">Cairo, Egypt</span>
            <div class="posting-description">
              Build resilient APIs in Node.js and TypeScript.
            </div>
          </body>
        </html>
      `,
    });

    expect(payload.sourceIdentifier).toBe('lever');
    expect(payload.extractionCandidate.title).toBe('Senior Backend Engineer');
    expect(payload.extractionCandidate.company).toBe('Example Labs');
    expect(payload.extractionCandidate.location).toContain('Cairo');
    expect(payload.extractionCandidate.description).toContain('Node.js');
  });

  it('keeps fallback behavior explicit when fields are sparse', () => {
    const payload = extractLeverPayload({
      sourceUrl: 'https://jobs.lever.co/example/empty',
      pageHtml: `
        <html>
          <body>
            <h2 class="posting-headline">Posting Title Only</h2>
          </body>
        </html>
      `,
    });

    expect(payload.ambiguityFlags).toContain('missing_description');
    expect(payload.ambiguityFlags).toContain('incomplete_primary_fields');
    expect(payload.extractionNotes).toContain('company_not_found');
    expect(payload.extractionNotes).toContain('location_not_found');
  });
});

