import type { EmploymentType, ExtractionPayload, WorkSetup } from '@career-rafiq/contracts';
import { countKeywordMatches, normalizeText, unique } from '../helpers.js';

export interface IndeedExtractionInput {
  sourceUrl: string;
  pageHtml: string;
}

interface ParsedJsonLdJobPosting {
  title?: string;
  description?: string;
  employmentType?: string | string[];
  hiringOrganization?: {
    name?: string;
  };
  jobLocation?: {
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
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
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanText(value: string | null | undefined): string {
  return stripTags(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function allMatches(html: string, pattern: RegExp): string[] {
  const values: string[] = [];
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const match of html.matchAll(globalPattern)) {
    const cleaned = cleanText(match[1]);
    if (cleaned) values.push(cleaned);
  }
  return unique(values);
}

function parseJsonLdJobPostings(html: string): ParsedJsonLdJobPosting[] {
  const postings: ParsedJsonLdJobPosting[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const block = match[1]?.trim();
    if (!block) continue;
    try {
      const parsed = JSON.parse(block) as unknown;
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      for (const object of objects) {
        if (!object || typeof object !== 'object') continue;
        const candidate = object as Record<string, unknown>;
        const typeField = candidate['@type'];
        const types = Array.isArray(typeField) ? typeField : [typeField];
        if (types.some((value) => typeof value === 'string' && normalizeText(value).includes('jobposting'))) {
          postings.push(candidate as ParsedJsonLdJobPosting);
        }
      }
    } catch {
      continue;
    }
  }
  return postings;
}

function locationFromJsonLd(jobPosting: ParsedJsonLdJobPosting): string | null {
  const address = jobPosting.jobLocation?.address;
  if (!address) return null;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
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

function sanitizeDescription(description: string): { description: string | null; contaminationTrimmed: boolean } {
  const cleaned = cleanText(description);
  if (!cleaned) return { description: null, contaminationTrimmed: false };
  const markers = [
    'jobs you may like',
    'similar jobs',
    'people also searched',
    'resume insights',
    'career advice hub',
    'hiring lab',
  ];
  const lower = cleaned.toLowerCase();
  let cut = cleaned.length;
  for (const marker of markers) {
    const index = lower.indexOf(marker);
    if (index >= 0 && index < cut) cut = index;
  }
  return {
    description: cleaned.slice(0, cut).trim() || null,
    contaminationTrimmed: cut < cleaned.length,
  };
}

function normalizeComparableTitle(value: string): string {
  return normalizeText(value).replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleLikelyMatches(left: string, right: string): boolean {
  const a = normalizeComparableTitle(left);
  const b = normalizeComparableTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

export function extractIndeedJob(input: IndeedExtractionInput): ExtractionPayload {
  const sourceConfidenceHints: string[] = [];
  const ambiguityFlags: string[] = [];
  const extractionNotes: string[] = ['raw_capture_content_preserved_from_input'];

  if (!/indeed\./i.test(input.sourceUrl)) {
    ambiguityFlags.push('non_indeed_url');
    extractionNotes.push('source_url_does_not_match_indeed_domain');
  }

  const pageHtml = input.pageHtml;
  const jsonLdJobs = parseJsonLdJobPostings(pageHtml);
  const primaryJsonLd = jsonLdJobs[0] ?? null;
  if (jsonLdJobs.length > 0) sourceConfidenceHints.push('jsonld_jobposting_detected');
  if (jsonLdJobs.length > 1) {
    ambiguityFlags.push('multiple_jobposting_blocks_detected');
    extractionNotes.push('selected_first_jobposting_block');
  }

  const title = firstMatch(pageHtml, [
    /<h1[^>]*class=["'][^"']*(?:jobsearch-JobInfoHeader-title|jobsearch-JobInfoHeader-title-container)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*data-testid=["']jobsearch-jobTitle["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ]) ?? (cleanText(primaryJsonLd?.title ?? null) || null);
  if (title) sourceConfidenceHints.push('detail_title_extracted');
  else extractionNotes.push('title_not_found');

  const company = firstMatch(pageHtml, [
    /<div[^>]*data-testid=["']inlineHeader-companyName["'][^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*class=["'][^"']*jobsearch-InlineCompanyRating-companyHeader[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*class=["'][^"']*jobsearch-InlineCompanyRating[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]) ?? (cleanText(primaryJsonLd?.hiringOrganization?.name ?? null) || null);
  if (company) sourceConfidenceHints.push('detail_company_extracted');
  else extractionNotes.push('company_not_found');

  const location = firstMatch(pageHtml, [
    /<div[^>]*data-testid=["']inlineHeader-companyLocation["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*data-testid=["']job-location["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*jobsearch-JobInfoHeader-subtitle[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]) ?? (locationFromJsonLd(primaryJsonLd ?? {}) || null);
  if (location) sourceConfidenceHints.push('detail_location_extracted');
  else extractionNotes.push('location_not_found');

  const descriptionRaw = firstMatch(pageHtml, [
    /<div[^>]*id=["']jobDescriptionText["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*data-testid=["']jobsearch-jobDescriptionText["'][^>]*>([\s\S]*?)<\/div>/i,
  ]) ?? (cleanText(primaryJsonLd?.description ?? null) || '');
  const descriptionSanitized = sanitizeDescription(descriptionRaw);
  const description = descriptionSanitized.description;
  if (description) sourceConfidenceHints.push('detail_description_extracted');
  else ambiguityFlags.push('missing_description');
  if (descriptionSanitized.contaminationTrimmed) {
    sourceConfidenceHints.push('description_contamination_trimmed');
    ambiguityFlags.push('description_contamination_risk');
    extractionNotes.push('trimmed_noisy_modules_from_description');
  }

  const listTitles = allMatches(
    pageHtml,
    /<(?:a|span|div)[^>]*class=["'][^"']*(?:tapItem|jobTitle|jobTitle-color-purple)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span|div)>/i,
  );
  if (listTitles.length > 1) sourceConfidenceHints.push('multiple_job_cards_detected');
  if (listTitles.length > 1 && title) {
    const matches = listTitles.filter((candidate) => titleLikelyMatches(title, candidate));
    if (matches.length === 0) {
      ambiguityFlags.push('mixed_job_risk');
      extractionNotes.push('visible_job_cards_do_not_match_selected_detail_title');
    }
    if (matches.length > 1) {
      ambiguityFlags.push('duplicate_card_title_risk');
      extractionNotes.push('multiple_cards_match_selected_detail_title');
    }
  }

  const textForSignals = cleanText(`${title ?? ''} ${location ?? ''} ${description ?? ''}`);
  const workSetup = inferWorkSetup(textForSignals);
  const employmentType = inferEmploymentType(
    [
      Array.isArray(primaryJsonLd?.employmentType)
        ? primaryJsonLd?.employmentType.join(' ')
        : primaryJsonLd?.employmentType ?? '',
      textForSignals,
    ].join(' '),
  );
  if (workSetup === 'unknown') extractionNotes.push('work_setup_unknown_due_to_no_strong_signal');
  if (employmentType === 'unknown') extractionNotes.push('employment_type_unknown_due_to_no_strong_signal');

  const keywords = countKeywordMatches(textForSignals, [
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
    'postgres',
    'sql',
    '.net',
    'c#',
    'java',
    'go',
    'machine learning',
    'ml',
    'llm',
  ]);

  const presentCritical = [title, company, description].filter(Boolean).length;
  if (presentCritical < 2) {
    sourceConfidenceHints.push('critical_fields_incomplete');
    ambiguityFlags.push('low_information_capture');
  }

  return {
    sourceIdentifier: 'indeed',
    sourceUrl: input.sourceUrl,
    rawCaptureContent: input.pageHtml,
    extractionCandidate: {
      title,
      company,
      location,
      workSetup,
      employmentType,
      description,
      recruiterOrPosterSignal: null,
      companySector: null,
      companyType: null,
      keywords: unique(keywords),
    },
    sourceConfidenceHints: unique(sourceConfidenceHints),
    ambiguityFlags: unique(ambiguityFlags),
    extractionNotes: unique(extractionNotes),
  };
}
