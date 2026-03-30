import type { EmploymentType, ExtractionPayload, WorkSetup } from '@career-rafiq/contracts';
import { countKeywordMatches, normalizeText, unique } from '../helpers.js';

export interface WorkdayExtractionInput {
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

function parseJsonLdJobPosting(html: string): Record<string, unknown> | null {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      for (const object of objects) {
        if (!object || typeof object !== 'object') continue;
        const typeValue = (object as Record<string, unknown>)['@type'];
        const types = Array.isArray(typeValue) ? typeValue : [typeValue];
        if (types.some((entry) => typeof entry === 'string' && normalizeText(entry).includes('jobposting'))) {
          return object as Record<string, unknown>;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function extractWorkdayPayload(input: WorkdayExtractionInput): ExtractionPayload {
  const sourceConfidenceHints: string[] = [];
  const ambiguityFlags: string[] = [];
  const extractionNotes: string[] = ['raw_capture_content_preserved_from_input'];
  const html = input.pageHtml;
  const jsonLd = parseJsonLdJobPosting(html);

  const title = cleanText(
    (typeof jsonLd?.['title'] === 'string' ? jsonLd['title'] : null) ??
      firstMatch(html, [
        /<h1[^>]*data-automation-id=["']jobPostingHeader["'][^>]*>([\s\S]*?)<\/h1>/i,
        /<h1[^>]*>([\s\S]*?)<\/h1>/i,
        /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
      ]),
  ) || null;
  if (title) sourceConfidenceHints.push('title_extracted');
  else extractionNotes.push('title_not_found');

  const company = cleanText(
    (jsonLd?.['hiringOrganization'] as { name?: unknown } | undefined)?.name as string | undefined,
  ) || firstMatch(html, [/<div[^>]*data-automation-id=["']companyName["'][^>]*>([\s\S]*?)<\/div>/i]);
  if (company) sourceConfidenceHints.push('company_extracted');
  else extractionNotes.push('company_not_found');

  const location = cleanText(
    firstMatch(html, [
      /<div[^>]*data-automation-id=["']locations["'][^>]*>([\s\S]*?)<\/div>/i,
      /<li[^>]*data-automation-id=["']locations["'][^>]*>([\s\S]*?)<\/li>/i,
    ]),
  ) || null;
  if (!location) extractionNotes.push('location_not_found');

  const description =
    cleanText(
      (typeof jsonLd?.['description'] === 'string' ? jsonLd['description'] : null) ??
        firstMatch(html, [
          /<div[^>]*data-automation-id=["']jobPostingDescription["'][^>]*>([\s\S]*?)<\/div>/i,
          /<section[^>]*aria-label=["']Job Description["'][^>]*>([\s\S]*?)<\/section>/i,
        ]),
    ) || null;
  if (description) sourceConfidenceHints.push('description_extracted');
  else ambiguityFlags.push('missing_description');

  const variantSignals = [
    /data-automation-id=["']jobPostingHeader["']/i.test(html),
    /wd-Hyperlink/i.test(html),
    /workday/i.test(input.sourceUrl),
  ].filter(Boolean).length;
  if (variantSignals >= 2) sourceConfidenceHints.push('workday_variant_detected');
  if (variantSignals === 0) ambiguityFlags.push('non_workday_pattern_risk');

  const composite = cleanText(`${title ?? ''} ${location ?? ''} ${description ?? ''}`);
  const workSetup = inferWorkSetup(composite);
  const employmentType = inferEmploymentType(composite);
  if (workSetup === 'unknown') extractionNotes.push('work_setup_unknown_due_to_no_strong_signal');
  if (employmentType === 'unknown') extractionNotes.push('employment_type_unknown_due_to_no_strong_signal');

  if (!title || !company) ambiguityFlags.push('incomplete_primary_fields');
  if (description && description.length < 120) {
    ambiguityFlags.push('short_description_possible_truncation');
  }

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
    sourceIdentifier: 'workday',
    sourceUrl: input.sourceUrl,
    rawCaptureContent: stripTags(html),
    extractionCandidate: {
      title,
      company: company || null,
      location,
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

export const extractWorkdayJob = extractWorkdayPayload;
