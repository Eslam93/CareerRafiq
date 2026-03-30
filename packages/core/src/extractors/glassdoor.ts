import type { EmploymentType, ExtractionPayload, WorkSetup } from '@career-rafiq/contracts';
import { countKeywordMatches, normalizeText, unique } from '../helpers.js';

export interface GlassdoorExtractionInput {
  sourceUrl: string;
  pageHtml: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(value: string): string {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|br|h1|h2|h3|h4)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanText(value: string | null | undefined): string {
  if (!value) return '';
  return stripTags(value).replace(/\s+/g, ' ').trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function inferWorkSetup(text: string): WorkSetup {
  const normalized = normalizeText(text);
  if (/\bhybrid\b/.test(normalized)) return 'hybrid';
  if (/\bon site\b|\bonsite\b|\bon-site\b/.test(normalized)) return 'onsite';
  if (/\bremote\b|\bwork from home\b/.test(normalized)) return 'remote';
  return 'unknown';
}

function inferEmploymentType(text: string): EmploymentType {
  const normalized = normalizeText(text);
  if (/\bfull time\b|\bfull-time\b/.test(normalized)) return 'full_time';
  if (/\bpart time\b|\bpart-time\b/.test(normalized)) return 'part_time';
  if (/\bcontract(or)?\b/.test(normalized)) return 'contract';
  if (/\bfreelance\b/.test(normalized)) return 'freelance';
  if (/\btemporary\b|\btemp\b/.test(normalized)) return 'temporary';
  if (/\bintern(ship)?\b/.test(normalized)) return 'internship';
  return 'unknown';
}

function sanitizeDescription(text: string): { description: string; contaminated: boolean } {
  const markers = ['similar jobs', 'company reviews', 'people also viewed', 'browse related jobs'];
  const lower = text.toLowerCase();
  let cut = text.length;
  for (const marker of markers) {
    const index = lower.indexOf(marker);
    if (index >= 0 && index < cut) cut = index;
  }
  return {
    description: text.slice(0, cut).trim(),
    contaminated: cut < text.length,
  };
}

export function extractGlassdoorPayload(input: GlassdoorExtractionInput): ExtractionPayload {
  const html = input.pageHtml;
  const sourceConfidenceHints: string[] = [];
  const ambiguityFlags: string[] = [];
  const extractionNotes: string[] = ['raw_capture_content_preserved_from_input'];

  const title = firstMatch(html, [
    /<h1[^>]*data-test=["']job-title["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*class=["'][^"']*JobDetails_jobTitle[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  ]);
  if (title) sourceConfidenceHints.push('title_extracted');

  const company = firstMatch(html, [
    /<div[^>]*data-test=["']employer-name["'][^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*class=["'][^"']*EmployerProfile_compactEmployerName[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
  ]);
  if (company) sourceConfidenceHints.push('company_extracted');

  const location = firstMatch(html, [
    /<div[^>]*data-test=["']location["'][^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*class=["'][^"']*JobDetails_location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
  ]);
  if (!location) extractionNotes.push('location_not_found');

  const rawDescription = firstMatch(html, [
    /<div[^>]*data-test=["']job-description["'][^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*class=["'][^"']*JobDescription_jobDescriptionContainer[^"']*["'][^>]*>([\s\S]*?)<\/article>/i,
  ]);
  const sanitized = sanitizeDescription(rawDescription ?? '');
  const description = sanitized.description || null;
  if (description) sourceConfidenceHints.push('description_extracted');
  if (!description) ambiguityFlags.push('missing_description');
  if (sanitized.contaminated) {
    ambiguityFlags.push('description_contamination_risk');
    extractionNotes.push('description_trimmed_to_primary_job_section');
  }

  const likelySecondaryCards = (html.match(/data-test=["']job-link["']/gi) ?? []).length;
  if (likelySecondaryCards > 1) {
    ambiguityFlags.push('multiple_visible_job_cards');
    extractionNotes.push('surrounding_job_cards_detected_in_capture');
  }

  if (!title || !company) ambiguityFlags.push('incomplete_primary_fields');

  const composite = cleanText(`${title ?? ''} ${location ?? ''} ${description ?? ''}`);
  const workSetup = inferWorkSetup(composite);
  const employmentType = inferEmploymentType(composite);
  if (workSetup === 'unknown') extractionNotes.push('work_setup_unknown_due_to_no_strong_signal');
  if (employmentType === 'unknown') extractionNotes.push('employment_type_unknown_due_to_no_strong_signal');

  const keywords = unique(
    countKeywordMatches(composite, [
      'typescript',
      'javascript',
      'python',
      'react',
      'node',
      'aws',
      'azure',
      'gcp',
      'kubernetes',
      'terraform',
      'fastapi',
      'postgres',
      '.net',
      'c#',
      'java',
      'go',
      'llm',
      'machine learning',
    ]),
  );

  return {
    sourceIdentifier: 'glassdoor',
    sourceUrl: input.sourceUrl,
    rawCaptureContent: stripTags(html),
    extractionCandidate: {
      title: title ?? null,
      company: company ?? null,
      location: location ?? null,
      workSetup,
      employmentType,
      description,
      recruiterOrPosterSignal: null,
      companySector: null,
      companyType: null,
      keywords,
    },
    sourceConfidenceHints: unique(sourceConfidenceHints),
    ambiguityFlags: unique(ambiguityFlags),
    extractionNotes: unique(extractionNotes),
  };
}

export const extractGlassdoorJob = extractGlassdoorPayload;
