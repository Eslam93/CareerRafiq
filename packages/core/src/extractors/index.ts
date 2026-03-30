import type { ExtractionPayload, SourceIdentifier } from '@career-rafiq/contracts';
import { extractGlassdoorJob } from './glassdoor.js';
import { extractGreenhousePayload } from './greenhouse.js';
import { extractIndeedJob } from './indeed.js';
import { extractLeverJob } from './lever.js';
import { extractLinkedInJob } from './linkedin.js';
import { extractWorkdayJob } from './workday.js';

export interface ExtractPagePayloadInput {
  sourceUrl: string;
  pageContent: string;
  sourceIdentifier?: SourceIdentifier | undefined;
}

const SUPPORTED_SOURCES: ReadonlySet<SourceIdentifier> = new Set([
  'linkedin',
  'indeed',
  'glassdoor',
  'greenhouse',
  'lever',
  'workday',
]);

export function detectSourceIdentifierFromUrl(sourceUrl: string): SourceIdentifier {
  const url = sourceUrl.toLowerCase();
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('indeed.')) return 'indeed';
  if (url.includes('glassdoor.')) return 'glassdoor';
  if (url.includes('greenhouse.io')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('myworkdayjobs.com') || url.includes('workday')) return 'workday';
  return 'unsupported';
}

export function isSourceSupported(sourceIdentifier: SourceIdentifier): boolean {
  return SUPPORTED_SOURCES.has(sourceIdentifier);
}

function buildUnsupportedPayload(sourceUrl: string, pageContent: string, sourceIdentifier: SourceIdentifier): ExtractionPayload {
  return {
    sourceIdentifier,
    sourceUrl,
    rawCaptureContent: pageContent,
    extractionCandidate: {
      title: null,
      company: null,
      location: null,
      workSetup: 'unknown',
      employmentType: 'unknown',
      description: null,
      recruiterOrPosterSignal: null,
      companySector: null,
      companyType: null,
      keywords: [],
    },
    sourceConfidenceHints: ['unsupported_source'],
    ambiguityFlags: ['manual_review_required'],
    extractionNotes: ['unsupported_source_manual_review_required'],
  };
}

export function extractPagePayload(input: ExtractPagePayloadInput): ExtractionPayload {
  const sourceIdentifier = input.sourceIdentifier ?? detectSourceIdentifierFromUrl(input.sourceUrl);
  switch (sourceIdentifier) {
    case 'linkedin':
      return extractLinkedInJob({ sourceUrl: input.sourceUrl, pageHtml: input.pageContent });
    case 'indeed':
      return extractIndeedJob({ sourceUrl: input.sourceUrl, pageHtml: input.pageContent });
    case 'glassdoor':
      return extractGlassdoorJob({ sourceUrl: input.sourceUrl, pageHtml: input.pageContent });
    case 'greenhouse':
      return extractGreenhousePayload({ sourceUrl: input.sourceUrl, pageContent: input.pageContent });
    case 'lever':
      return extractLeverJob({ sourceUrl: input.sourceUrl, pageHtml: input.pageContent });
    case 'workday':
      return extractWorkdayJob({ sourceUrl: input.sourceUrl, pageHtml: input.pageContent });
    default:
      return buildUnsupportedPayload(input.sourceUrl, input.pageContent, sourceIdentifier);
  }
}

export { extractGlassdoorJob } from './glassdoor.js';
export { extractGreenhousePayload } from './greenhouse.js';
export { extractIndeedJob } from './indeed.js';
export { extractLeverJob } from './lever.js';
export { extractLinkedInJob } from './linkedin.js';
export { extractWorkdayJob } from './workday.js';
