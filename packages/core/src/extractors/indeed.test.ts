import { describe, expect, it } from 'vitest';
import { extractIndeedJob } from './indeed.js';

describe('extractIndeedJob', () => {
  it('extracts visible primary job details and trims noisy surrounding content', () => {
    const pageHtml = `
      <html>
        <body>
          <h1 class="jobsearch-JobInfoHeader-title">Senior Backend Engineer</h1>
          <div data-testid="inlineHeader-companyName">Acme Inc</div>
          <div data-testid="inlineHeader-companyLocation">Cairo, Egypt (Hybrid)</div>
          <div id="jobDescriptionText">
            Build APIs with TypeScript, Node.js, and AWS.
            Work closely with platform teams.
            Jobs you may like
            Unrelated listing follows.
          </div>
          <a class="tapItem">Senior Backend Engineer</a>
          <a class="tapItem">Data Engineer</a>
        </body>
      </html>
    `;

    const result = extractIndeedJob({
      sourceUrl: 'https://www.indeed.com/viewjob?jk=abc123',
      pageHtml,
    });

    expect(result.sourceIdentifier).toBe('indeed');
    expect(result.rawCaptureContent).toBe(pageHtml);
    expect(result.extractionCandidate.title).toBe('Senior Backend Engineer');
    expect(result.extractionCandidate.company).toBe('Acme Inc');
    expect(result.extractionCandidate.location).toBe('Cairo, Egypt (Hybrid)');
    expect(result.extractionCandidate.workSetup).toBe('hybrid');
    expect(result.extractionCandidate.description).toBe(
      'Build APIs with TypeScript, Node.js, and AWS. Work closely with platform teams.',
    );
    expect(result.extractionCandidate.keywords).toEqual(
      expect.arrayContaining(['typescript', 'node', 'aws']),
    );
    expect(result.sourceConfidenceHints).toContain('description_contamination_trimmed');
    expect(result.ambiguityFlags).toContain('description_contamination_risk');
  });

  it('surfaces mixed-job risk when list cards do not match detail title', () => {
    const pageHtml = `
      <html>
        <body>
          <h1 class="jobsearch-JobInfoHeader-title">Product Designer</h1>
          <div data-testid="inlineHeader-companyName">Acme Inc</div>
          <div id="jobDescriptionText">Design systems and UI workflows.</div>
          <a class="tapItem">Backend Engineer</a>
          <a class="tapItem">Platform Engineer</a>
          <a class="tapItem">Data Engineer</a>
        </body>
      </html>
    `;

    const result = extractIndeedJob({
      sourceUrl: 'https://www.indeed.com/viewjob?jk=xyz987',
      pageHtml,
    });

    expect(result.sourceConfidenceHints).toContain('multiple_job_cards_detected');
    expect(result.ambiguityFlags).toContain('mixed_job_risk');
    expect(result.extractionNotes).toContain('visible_job_cards_do_not_match_selected_detail_title');
  });

  it('falls back to JSON-LD data and keeps unknown signals explicit', () => {
    const pageHtml = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Principal .NET Engineer",
              "description": "<p>Build distributed systems using C# and Azure.</p>",
              "hiringOrganization": { "name": "Contoso" },
              "jobLocation": {
                "address": {
                  "addressLocality": "Berlin",
                  "addressRegion": "BE",
                  "addressCountry": "DE"
                }
              }
            }
          </script>
        </head>
        <body>
          <p>No explicit header fields available.</p>
        </body>
      </html>
    `;

    const result = extractIndeedJob({
      sourceUrl: 'https://www.indeed.com/viewjob?jk=fallback',
      pageHtml,
    });

    expect(result.extractionCandidate.title).toBe('Principal .NET Engineer');
    expect(result.extractionCandidate.company).toBe('Contoso');
    expect(result.extractionCandidate.location).toBe('Berlin, BE, DE');
    expect(result.extractionCandidate.description).toContain('Build distributed systems using C# and Azure.');
    expect(result.extractionCandidate.workSetup).toBe('unknown');
    expect(result.extractionCandidate.employmentType).toBe('unknown');
    expect(result.sourceConfidenceHints).toContain('jsonld_jobposting_detected');
    expect(result.extractionNotes).toEqual(
      expect.arrayContaining([
        'work_setup_unknown_due_to_no_strong_signal',
        'employment_type_unknown_due_to_no_strong_signal',
      ]),
    );
  });
});
