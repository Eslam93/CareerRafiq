import type { EmploymentType, ExtractionPayload, WorkSetup } from '@career-rafiq/contracts';
import { countKeywordMatches, normalizeText, unique } from '../helpers.js';

export interface LeverExtractionInput {
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

export function extractLeverPayload(input: LeverExtractionInput): ExtractionPayload {
  const html = input.pageHtml;
  const sourceConfidenceHints: string[] = [];
  const ambiguityFlags: string[] = [];
  const extractionNotes: string[] = ['raw_capture_content_preserved_from_input'];

  const title = firstMatch(html, [
    /<h2[^>]*class=["'][^"']*posting-headline[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  ]);
  if (title) sourceConfidenceHints.push('title_extracted');

  const company = firstMatch(html, [
    /<a[^>]*class=["'][^"']*main-header-logo[^"']*["'][^>]*aria-label=["']([^"']+)["']/i,
    /<div[^>]*class=["'][^"']*posting-categories[^"']*["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
  ]);
  if (company) sourceConfidenceHints.push('company_extracted');
  else extractionNotes.push('company_not_found');

  const location = firstMatch(html, [
    /<span[^>]*class=["'][^"']*sort-by-location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*class=["'][^"']*posting-categories[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]);
  if (!location) extractionNotes.push('location_not_found');

  const description = firstMatch(html, [
    /<div[^>]*class=["'][^"']*posting-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
  ]);
  if (description) sourceConfidenceHints.push('description_extracted');
  else ambiguityFlags.push('missing_description');

  const composite = cleanText(`${title ?? ''} ${location ?? ''} ${description ?? ''}`);
  const workSetup = inferWorkSetup(composite);
  const employmentType = inferEmploymentType(composite);
  if (workSetup === 'unknown') extractionNotes.push('work_setup_unknown_due_to_no_strong_signal');
  if (employmentType === 'unknown') extractionNotes.push('employment_type_unknown_due_to_no_strong_signal');

  if (!title || !company) ambiguityFlags.push('incomplete_primary_fields');
  if (description && description.length < 120) ambiguityFlags.push('short_description_possible_truncation');

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
    sourceIdentifier: 'lever',
    sourceUrl: input.sourceUrl,
    rawCaptureContent: stripTags(html),
    extractionCandidate: {
      title: title ?? null,
      company: company ?? null,
      location: location ?? null,
      workSetup,
      employmentType,
      description: description ?? null,
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

export const extractLeverJob = extractLeverPayload;
