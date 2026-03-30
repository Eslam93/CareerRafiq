import { describe, expect, it } from 'vitest';
import { extractLinkedInJob } from './linkedin.js';

describe('extractLinkedInJob', () => {
  it('extracts selected detail panel data and trims noisy LinkedIn modules', () => {
    const pageHtml = `
      <ul>
        <li class="jobs-search-results__list-item jobs-search-results__list-item--active" data-occludable-job-id="111">
          <a class="job-card-list__title">Senior Backend Engineer</a>
        </li>
        <li class="jobs-search-results__list-item" data-occludable-job-id="112">
          <a class="job-card-list__title">Data Engineer</a>
        </li>
      </ul>
      <section class="jobs-details">
        <h1 class="job-details-jobs-unified-top-card__job-title">Senior Backend Engineer</h1>
        <a class="job-details-jobs-unified-top-card__company-name">Acme Inc</a>
        <span class="job-details-jobs-unified-top-card__bullet">Remote</span>
        <div class="show-more-less-html__markup">
          Build APIs with TypeScript and AWS.
          People also viewed
          Another unrelated listing
        </div>
      </section>
    `;

    const result = extractLinkedInJob({
      sourceUrl: 'https://www.linkedin.com/jobs/view/111',
      pageHtml,
    });

    expect(result.sourceIdentifier).toBe('linkedin');
    expect(result.extractionCandidate.title).toBe('Senior Backend Engineer');
    expect(result.extractionCandidate.company).toBe('Acme Inc');
    expect(result.extractionCandidate.workSetup).toBe('remote');
    expect(result.extractionCandidate.description).toBe('Build APIs with TypeScript and AWS.');
    expect(result.sourceConfidenceHints).toContain('selected_job_signal_detected');
    expect(result.sourceConfidenceHints).toContain('description_contamination_trimmed');
    expect(result.ambiguityFlags).toContain('description_contamination_risk');
  });

  it('flags mixed-job risk when detail panel title does not match visible job cards', () => {
    const pageHtml = `
      <ul>
        <li class="jobs-search-results__list-item jobs-search-results__list-item--active" data-occludable-job-id="111">
          <a class="job-card-list__title">Senior Backend Engineer</a>
        </li>
        <li class="jobs-search-results__list-item" data-occludable-job-id="112">
          <a class="job-card-list__title">Platform Engineer</a>
        </li>
      </ul>
      <section>
        <h1 class="job-details-jobs-unified-top-card__job-title">Product Designer</h1>
        <a class="job-details-jobs-unified-top-card__company-name">Acme Inc</a>
        <div class="show-more-less-html__markup">Design systems and UI flows.</div>
      </section>
    `;

    const result = extractLinkedInJob({
      sourceUrl: 'https://www.linkedin.com/jobs/view/111',
      pageHtml,
    });

    expect(result.ambiguityFlags).toContain('mixed_job_risk');
    expect(result.extractionNotes.join(' ')).toContain('Adjacent-job contamination is possible.');
  });

  it('falls back to JSON-LD payload and surfaces selected-job unknown risk', () => {
    const pageHtml = `
      <ul>
        <li class="jobs-search-results__list-item">
          <a class="job-card-list__title">Principal .NET Engineer</a>
        </li>
        <li class="jobs-search-results__list-item">
          <a class="job-card-list__title">Staff Python Engineer</a>
        </li>
      </ul>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "Principal .NET Engineer",
          "description": "<p>Build distributed services with C# and Azure.</p>",
          "hiringOrganization": { "name": "Contoso" },
          "jobLocation": {
            "address": { "addressLocality": "Cairo", "addressRegion": "Cairo Governorate" }
          }
        }
      </script>
    `;

    const result = extractLinkedInJob({
      sourceUrl: 'https://www.linkedin.com/jobs/search/?currentJobId=111',
      pageHtml,
    });

    expect(result.extractionCandidate.title).toBe('Principal .NET Engineer');
    expect(result.extractionCandidate.company).toBe('Contoso');
    expect(result.extractionCandidate.location).toBe('Cairo, Cairo Governorate');
    expect(result.extractionCandidate.description).toContain('Build distributed services with C# and Azure.');
    expect(result.extractionCandidate.keywords).toContain('.net');
    expect(result.ambiguityFlags).toContain('selected_job_unknown');
  });
});
