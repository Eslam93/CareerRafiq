import { describe, expect, it } from 'vitest';
import { extractGreenhousePayload } from './greenhouse.js';

describe('extractGreenhousePayload', () => {
  it('extracts common Greenhouse fields from JSON-LD and heading content', () => {
    const pageContent = `
      <html>
        <head>
          <title>Job Application for Backend Engineer at Acme Labs</title>
          <meta property="og:title" content="Job Application for Backend Engineer at Acme Labs" />
          <script type="application/ld+json">
            {
              "@context":"https://schema.org",
              "@type":"JobPosting",
              "title":"Backend Engineer",
              "description":"<p>Build APIs with Python, FastAPI, PostgreSQL, and AWS.</p>",
              "employmentType":"FULL_TIME",
              "hiringOrganization":{"name":"Acme Labs"},
              "jobLocation":[{"address":{"addressLocality":"Cairo","addressRegion":"Cairo Governorate","addressCountry":"EG"}}]
            }
          </script>
        </head>
        <body>
          <h1>Backend Engineer</h1>
          <div>Location: Cairo, Cairo Governorate, EG</div>
          <div>Remote (EMEA)</div>
          <div>Department: Engineering</div>
        </body>
      </html>
    `;

    const result = extractGreenhousePayload({
      sourceUrl: 'https://boards.greenhouse.io/acmelabs/jobs/12345',
      pageContent,
    });

    expect(result.sourceIdentifier).toBe('greenhouse');
    expect(result.rawCaptureContent).toBe(pageContent);
    expect(result.extractionCandidate.title).toBe('Backend Engineer');
    expect(result.extractionCandidate.company).toBe('Acme Labs');
    expect(result.extractionCandidate.location).toBe('Cairo, Cairo Governorate, EG');
    expect(result.extractionCandidate.workSetup).toBe('remote');
    expect(result.extractionCandidate.employmentType).toBe('full_time');
    expect(result.extractionCandidate.description).toContain('Build APIs with Python');
    expect(result.extractionCandidate.keywords).toEqual(
      expect.arrayContaining(['python', 'fastapi', 'postgres', 'aws']),
    );
    expect(result.sourceConfidenceHints).toEqual(expect.arrayContaining(['jsonld_jobposting_detected']));
    expect(result.extractionNotes).toContain('raw_capture_content_preserved_from_input');
  });

  it('falls back to visible page content when structured data is missing', () => {
    const pageContent = `
      <html>
        <head>
          <title>Senior Platform Engineer at Orbit Systems</title>
        </head>
        <body>
          <h1>Senior Platform Engineer</h1>
          <div>Location: Berlin, Germany</div>
          <section>
            <h2>About the role</h2>
            <p>We are hiring a Platform Engineer to build Kubernetes and Terraform foundations.</p>
            <p>You will work with AWS and Python to improve release reliability and developer tooling.</p>
          </section>
          <div>Employment Type: Contract</div>
          <button>Apply</button>
        </body>
      </html>
    `;

    const result = extractGreenhousePayload({
      sourceUrl: 'https://boards.greenhouse.io/orbitsystems/jobs/777',
      pageContent,
    });

    expect(result.extractionCandidate.title).toBe('Senior Platform Engineer');
    expect(result.extractionCandidate.company).toBe('Orbit Systems');
    expect(result.extractionCandidate.location).toBe('Berlin, Germany');
    expect(result.extractionCandidate.employmentType).toBe('contract');
    expect(result.extractionCandidate.description).toContain('Platform Engineer');
    expect(result.extractionCandidate.keywords).toEqual(
      expect.arrayContaining(['kubernetes', 'terraform', 'aws', 'python']),
    );
    expect(result.sourceConfidenceHints).toContain('description_from_visible_text');
  });

  it('sets ambiguity flags for conflicting title/location signals and multi-job indicators', () => {
    const pageContent = `
      <html>
        <head>
          <title>Job Application for Data Engineer at Northwind</title>
          <meta property="og:title" content="Job Application for Senior Data Engineer at Northwind" />
        </head>
        <body>
          <h1>Data Engineer</h1>
          <h1>Analytics Engineer</h1>
          <div>Location: Dublin, Ireland</div>
          <div>Location: Remote - EMEA</div>
          <p>Job Application for Data Engineer at Northwind</p>
          <p>Job Application for Analytics Engineer at Northwind</p>
          <p>Build data pipelines using Python and dbt.</p>
        </body>
      </html>
    `;

    const result = extractGreenhousePayload({
      sourceUrl: 'https://boards.greenhouse.io/northwind/jobs/333',
      pageContent,
    });

    expect(result.ambiguityFlags).toEqual(
      expect.arrayContaining([
        'multiple_h1_titles_detected',
        'multiple_title_candidates',
        'multiple_location_candidates',
        'possible_multi_job_content',
      ]),
    );
  });

  it('keeps unknowns explicit and records source-url assumptions when domain is not greenhouse', () => {
    const pageContent = `
      <html>
        <head><title>Job Application for Engineer at Contoso</title></head>
        <body>
          <h1>Engineer</h1>
          <p>Build backend systems.</p>
        </body>
      </html>
    `;

    const result = extractGreenhousePayload({
      sourceUrl: 'https://example.com/careers/engineer',
      pageContent,
    });

    expect(result.extractionCandidate.workSetup).toBe('unknown');
    expect(result.extractionCandidate.employmentType).toBe('unknown');
    expect(result.ambiguityFlags).toContain('non_greenhouse_url');
    expect(result.extractionNotes).toEqual(
      expect.arrayContaining([
        'source_url_does_not_match_greenhouse_domain',
        'work_setup_unknown_due_to_no_strong_signal',
        'employment_type_unknown_due_to_no_strong_signal',
      ]),
    );
  });
});
