import type { EmploymentType, ExtractionPayload, WorkSetup } from '@career-rafiq/contracts';
import { countKeywordMatches, normalizeText, unique } from '../helpers.js';

export interface GreenhouseExtractionInput {
  sourceUrl: string;
  pageContent: string;
}

interface ParsedJsonLdJobPosting {
  title?: string;
  description?: string;
  employmentType?: string | string[];
  hiringOrganization?: {
    name?: string;
  };
  jobLocation?: Array<{
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  }>;
  jobLocationType?: string;
}

const EMPLOYMENT_PATTERNS: Array<{ pattern: RegExp; value: EmploymentType }> = [
  { pattern: /\bfull[\s_-]?time\b/i, value: 'full_time' },
  { pattern: /\bpart[\s_-]?time\b/i, value: 'part_time' },
  { pattern: /\bcontract(or)?\b/i, value: 'contract' },
  { pattern: /\bfreelance\b/i, value: 'freelance' },
  { pattern: /\btemporary\b|\btemp\b/i, value: 'temporary' },
  { pattern: /\bintern(ship)?\b/i, value: 'internship' },
];

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|br)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractMetaContent(pageContent: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`,
    'i',
  );
  const match = pageContent.match(regex)?.[1];
  return match ? decodeHtmlEntities(match.trim()) : null;
}

function extractTagText(pageContent: string, tag: 'h1' | 'title'): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const values: string[] = [];
  let match = regex.exec(pageContent);
  while (match) {
    const cleaned = stripTags(match[1] ?? '').trim();
    if (cleaned) values.push(cleaned);
    match = regex.exec(pageContent);
  }
  return unique(values);
}

function extractJsonLdBlocks(pageContent: string): string[] {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: string[] = [];
  let match = regex.exec(pageContent);
  while (match) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
    match = regex.exec(pageContent);
  }
  return blocks;
}

function parseJsonLdJobPostings(pageContent: string): ParsedJsonLdJobPosting[] {
  const postings: ParsedJsonLdJobPosting[] = [];
  for (const block of extractJsonLdBlocks(pageContent)) {
    try {
      const parsed = JSON.parse(block) as unknown;
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of objects) {
        const object = entry as Record<string, unknown>;
        const typeValue = object['@type'];
        const types = Array.isArray(typeValue) ? typeValue : [typeValue];
        if (types.some((value) => typeof value === 'string' && normalizeText(value).includes('jobposting'))) {
          postings.push(object as ParsedJsonLdJobPosting);
        }
      }
    } catch {
      continue;
    }
  }
  return postings;
}

function normalizeTitle(value: string): string {
  return value
    .replace(/^job application for\s+/i, '')
    .replace(/\s*\|\s*greenhouse\s*$/i, '')
    .replace(/\s*-\s*greenhouse\s*$/i, '')
    .trim();
}

function extractCompanyFromTitleLike(value: string): string | null {
  const cleaned = value.trim();
  const atMatch = cleaned.match(/\bat\s+(.+)$/i);
  if (atMatch?.[1]) return atMatch[1].trim();
  const pipeMatch = cleaned.match(/^[^-|]+(?:\s*[-|]\s*)(.+)$/);
  if (pipeMatch?.[1]) return pipeMatch[1].replace(/\bcareers?\b/gi, '').trim() || null;
  return null;
}

function inferWorkSetup(text: string): WorkSetup {
  const normalized = normalizeText(text);
  if (/\bhybrid\b/.test(normalized)) return 'hybrid';
  if (/\bon[\s-]?site\b|\bonsite\b/.test(normalized)) return 'onsite';
  if (/\bremote\b|\bwork from home\b|\bdistributed\b/.test(normalized)) return 'remote';
  return 'unknown';
}

function inferEmploymentType(text: string): EmploymentType {
  for (const mapping of EMPLOYMENT_PATTERNS) {
    if (mapping.pattern.test(text)) return mapping.value;
  }
  return 'unknown';
}

function extractLocationCandidates(text: string): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines.slice(0, 80)) {
    if (/^(location|office|city|region)\s*[:\-]\s+/i.test(line)) {
      candidates.push(line.replace(/^(location|office|city|region)\s*[:\-]\s+/i, '').trim());
      continue;
    }
    if (/^[A-Za-z .'-]+,\s*[A-Za-z]{2,}(?:,\s*[A-Za-z]{2,})?$/.test(line)) {
      candidates.push(line);
      continue;
    }
    if (/remote/i.test(line)) {
      candidates.push(line);
    }
  }
  return unique(candidates);
}

function chooseBest<T>(values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function cleanDescription(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h2|h3|h4)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildFallbackDescription(visibleText: string, title: string | null, company: string | null, location: string | null): string | null {
  const lines = visibleText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => {
    if (title && normalizeText(line) === normalizeText(title)) return false;
    if (company && normalizeText(line) === normalizeText(company)) return false;
    if (location && normalizeText(line) === normalizeText(location)) return false;
    if (/^(apply|share job|back to jobs|department|office|location[:\-]?|employment type[:\-]?)$/i.test(line)) return false;
    return line.length >= 20;
  });
  const joined = filtered.slice(0, 120).join('\n');
  return joined.length >= 120 ? joined : null;
}

function locationFromJsonLd(job: ParsedJsonLdJobPosting): string | null {
  const firstLocation = job.jobLocation?.[0];
  const address = firstLocation?.address;
  if (!address) return null;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

export function extractGreenhousePayload(input: GreenhouseExtractionInput): ExtractionPayload {
  const sourceConfidenceHints: string[] = [];
  const ambiguityFlags: string[] = [];
  const extractionNotes: string[] = ['raw_capture_content_preserved_from_input'];

  const isGreenhouseUrl = /greenhouse\.io/i.test(input.sourceUrl);
  if (!isGreenhouseUrl) {
    ambiguityFlags.push('non_greenhouse_url');
    extractionNotes.push('source_url_does_not_match_greenhouse_domain');
  }

  const rawCaptureContent = input.pageContent;
  const visibleText = stripTags(input.pageContent);
  const jsonLdJobs = parseJsonLdJobPostings(input.pageContent);
  const primaryJsonLd = jsonLdJobs[0] ?? null;
  if (jsonLdJobs.length > 0) sourceConfidenceHints.push('jsonld_jobposting_detected');
  if (jsonLdJobs.length > 1) {
    ambiguityFlags.push('multiple_jobposting_blocks_detected');
    extractionNotes.push('selected_first_jobposting_block');
  }

  const h1Candidates = extractTagText(input.pageContent, 'h1').map(normalizeTitle);
  if (h1Candidates.length > 0) sourceConfidenceHints.push('h1_title_detected');
  if (h1Candidates.length > 1) ambiguityFlags.push('multiple_h1_titles_detected');

  const titleTagCandidates = extractTagText(input.pageContent, 'title').map(normalizeTitle);
  const ogTitle = extractMetaContent(input.pageContent, 'og:title');
  const twitterTitle = extractMetaContent(input.pageContent, 'twitter:title');
  const titleCandidates = unique([
    primaryJsonLd?.title ? normalizeTitle(primaryJsonLd.title) : '',
    ...h1Candidates,
    ogTitle ? normalizeTitle(ogTitle) : '',
    twitterTitle ? normalizeTitle(twitterTitle) : '',
    ...titleTagCandidates,
  ].filter(Boolean));
  if (titleCandidates.length > 1) ambiguityFlags.push('multiple_title_candidates');

  const title = titleCandidates[0] ?? null;
  if (title && primaryJsonLd?.title) sourceConfidenceHints.push('title_from_structured_data');
  else if (title) sourceConfidenceHints.push('title_from_visual_heading_or_meta');
  else extractionNotes.push('title_not_found');

  const companyFromJsonLd = primaryJsonLd?.hiringOrganization?.name?.trim() ?? null;
  const ogSiteName = extractMetaContent(input.pageContent, 'og:site_name');
  const companyFromTitle = chooseBest([
    ...titleCandidates.map((candidate) => extractCompanyFromTitleLike(candidate)),
    ...titleTagCandidates.map((candidate) => extractCompanyFromTitleLike(candidate)),
  ]);
  const companyCandidates = unique([companyFromJsonLd ?? '', companyFromTitle ?? '', ogSiteName ?? ''].filter(Boolean));
  if (companyCandidates.length > 1) ambiguityFlags.push('multiple_company_candidates');
  const company = companyCandidates[0] ?? null;
  if (companyFromJsonLd) sourceConfidenceHints.push('company_from_structured_data');
  else if (companyFromTitle) sourceConfidenceHints.push('company_inferred_from_title_pattern');
  else extractionNotes.push('company_not_found');

  const locationCandidates = unique([
    locationFromJsonLd(primaryJsonLd ?? {}),
    ...extractLocationCandidates(visibleText),
  ].filter((value): value is string => Boolean(value)));
  if (locationCandidates.length > 1) ambiguityFlags.push('multiple_location_candidates');
  const location = locationCandidates[0] ?? null;
  if (primaryJsonLd && locationFromJsonLd(primaryJsonLd)) sourceConfidenceHints.push('location_from_structured_data');
  else if (location) sourceConfidenceHints.push('location_from_visible_content');
  else extractionNotes.push('location_not_found');

  const descriptionFromJsonLd = primaryJsonLd?.description ? cleanDescription(primaryJsonLd.description) : null;
  const descriptionFromMeta = extractMetaContent(input.pageContent, 'og:description') ?? extractMetaContent(input.pageContent, 'description');
  const fallbackDescription = buildFallbackDescription(visibleText, title, company, location);
  const description = chooseBest([
    descriptionFromJsonLd,
    descriptionFromMeta ? cleanDescription(descriptionFromMeta) : null,
    fallbackDescription,
  ]);
  if (descriptionFromJsonLd) sourceConfidenceHints.push('description_from_structured_data');
  else if (fallbackDescription) sourceConfidenceHints.push('description_from_visible_text');
  if (!description) extractionNotes.push('description_not_found');
  if (description && description.length < 180) ambiguityFlags.push('short_description_possible_truncation');

  const compositeText = unique([title ?? '', location ?? '', description ?? '', visibleText.slice(0, 3000)]).join('\n');
  const workSetup = primaryJsonLd?.jobLocationType && /telecommute/i.test(primaryJsonLd.jobLocationType)
    ? 'remote'
    : inferWorkSetup(compositeText);
  const employmentType = inferEmploymentType(
    unique([
      Array.isArray(primaryJsonLd?.employmentType) ? primaryJsonLd?.employmentType.join(' ') : primaryJsonLd?.employmentType ?? '',
      compositeText,
    ]).join('\n'),
  );
  if (workSetup === 'unknown') extractionNotes.push('work_setup_unknown_due_to_no_strong_signal');
  else sourceConfidenceHints.push('work_setup_inferred_from_content');
  if (employmentType === 'unknown') extractionNotes.push('employment_type_unknown_due_to_no_strong_signal');
  else sourceConfidenceHints.push('employment_type_inferred_from_content');

  const recruiterOrPosterSignal = null;
  const companySector = null;
  const companyType = null;

  const keywords = countKeywordMatches(
    unique([title ?? '', description ?? '', visibleText.slice(0, 3000)]).join(' '),
    [
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
      'postgresql',
      'java',
      'go',
      '.net',
      'c#',
      'machine learning',
      'llm',
      'ml',
    ],
  );

  const likelyAdditionalJobMarkers = (visibleText.match(/\bjob application for\b/gi) ?? []).length;
  if (likelyAdditionalJobMarkers > 1) ambiguityFlags.push('possible_multi_job_content');

  return {
    sourceIdentifier: 'greenhouse',
    sourceUrl: input.sourceUrl,
    rawCaptureContent,
    extractionCandidate: {
      title,
      company,
      location,
      workSetup,
      employmentType,
      description,
      recruiterOrPosterSignal,
      companySector,
      companyType,
      keywords,
    },
    sourceConfidenceHints: unique(sourceConfidenceHints),
    ambiguityFlags: unique(ambiguityFlags),
    extractionNotes: unique(extractionNotes),
  };
}
