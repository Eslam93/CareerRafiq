import type { EmploymentType, ExtractionPayload, WorkSetup } from '@career-rafiq/contracts';
import { countKeywordMatches, normalizeText, unique } from '../helpers.js';

export interface LinkedInExtractionInput {
  sourceUrl: string;
  pageHtml: string;
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanText(value: string | null | undefined): string {
  if (!value) return '';
  return decodeHtml(stripTags(value)).replace(/\s+/g, ' ').trim();
}

function normalizeComparableTitle(value: string): string {
  return normalizeText(value).replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleLikelyMatches(detailTitle: string, cardTitle: string): boolean {
  const detail = normalizeComparableTitle(detailTitle);
  const card = normalizeComparableTitle(cardTitle);
  if (!detail || !card) return false;
  if (detail === card) return true;
  return detail.includes(card) || card.includes(detail);
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanText(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function allMatches(html: string, pattern: RegExp): string[] {
  const values: string[] = [];
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const match of html.matchAll(regex)) {
    if (match[1]) {
      const cleaned = cleanText(match[1]);
      if (cleaned) values.push(cleaned);
    }
  }
  return unique(values);
}

function inferWorkSetup(text: string): WorkSetup {
  const normalized = normalizeText(text);
  if (normalized.includes('remote')) return 'remote';
  if (normalized.includes('hybrid')) return 'hybrid';
  if (normalized.includes('on site') || normalized.includes('onsite') || normalized.includes('on-site')) return 'onsite';
  return 'unknown';
}

function inferEmploymentType(text: string): EmploymentType {
  const normalized = normalizeText(text);
  if (normalized.includes('full time') || normalized.includes('full-time')) return 'full_time';
  if (normalized.includes('part time') || normalized.includes('part-time')) return 'part_time';
  if (normalized.includes('contract')) return 'contract';
  if (normalized.includes('freelance')) return 'freelance';
  if (normalized.includes('temporary') || normalized.includes('temp role')) return 'temporary';
  if (normalized.includes('internship') || normalized.includes('intern ')) return 'internship';
  return 'unknown';
}

function sanitizeDescription(raw: string): { description: string; contaminationMarkerFound: string | null } {
  const compact = cleanText(raw);
  if (!compact) return { description: '', contaminationMarkerFound: null };
  const contaminationMarkers = [
    'people also viewed',
    'similar jobs',
    'jobs you may be interested in',
    'meet the hiring team',
    'about the company',
    'more jobs from',
  ];
  const lower = compact.toLowerCase();
  let cutIndex = compact.length;
  for (const marker of contaminationMarkers) {
    const idx = lower.indexOf(marker);
    if (idx >= 0 && idx < cutIndex) {
      cutIndex = idx;
    }
  }
  const contaminationMarkerFound = cutIndex < compact.length ? compact.slice(cutIndex).split(' ').slice(0, 6).join(' ') : null;
  return {
    description: compact.slice(0, cutIndex).trim(),
    contaminationMarkerFound,
  };
}

function parseLinkedInJsonLd(html: string): { title: string | null; company: string | null; location: string | null; description: string | null } {
  const scripts: string[] = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1]) {
      scripts.push(match[1].trim());
    }
  }

  for (const content of scripts) {
    try {
      const data = JSON.parse(content);
      const objects = Array.isArray(data) ? data : [data];
      for (const object of objects) {
        if (!object || typeof object !== 'object') continue;
        const typeValue = String((object as Record<string, unknown>)['@type'] ?? '').toLowerCase();
        if (typeValue !== 'jobposting') continue;
        const record = object as Record<string, unknown>;
        const hiringOrganization = (record['hiringOrganization'] ?? {}) as Record<string, unknown>;
        const title = typeof record['title'] === 'string' ? cleanText(record['title']) : null;
        const company = typeof hiringOrganization['name'] === 'string' ? cleanText(hiringOrganization['name']) : null;
        const locationRaw = (record['jobLocation'] ?? {}) as Record<string, unknown>;
        const address = (locationRaw['address'] ?? {}) as Record<string, unknown>;
        const locality = typeof address['addressLocality'] === 'string' ? cleanText(address['addressLocality']) : '';
        const region = typeof address['addressRegion'] === 'string' ? cleanText(address['addressRegion']) : '';
        const location = cleanText(`${locality}${locality && region ? ', ' : ''}${region}`) || null;
        const description = typeof record['description'] === 'string' ? cleanText(record['description']) : null;
        return { title, company, location, description };
      }
    } catch {
      continue;
    }
  }
  return { title: null, company: null, location: null, description: null };
}

function parseSelectedJobSignal(html: string): { selectedSignal: boolean; selectedJobId: string | null; listTitles: string[] } {
  const selectedSignal =
    /jobs-search-results__list-item--active/i.test(html) ||
    /aria-current=["']true["']/i.test(html) ||
    /jobs-search-two-pane__job-card-container--selected/i.test(html);

  const selectedJobId = firstMatch(html, [
    /jobs-search-results__list-item--active[^>]*data-occludable-job-id=["']([^"']+)["']/i,
    /jobs-search-two-pane__job-card-container--selected[^>]*data-job-id=["']([^"']+)["']/i,
  ]);

  const listTitles = allMatches(
    html,
    /<(?:a|span|div)[^>]*class=["'][^"']*(?:job-card-list__title|job-card-container__link|job-card-list__position-title)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span|div)>/i,
  );
  return { selectedSignal, selectedJobId, listTitles };
}

function parseDetailPanel(html: string): { title: string | null; company: string | null; location: string | null; description: string | null } {
  const title = firstMatch(html, [
    /<h1[^>]*class=["'][^"']*(?:top-card-layout__title|job-details-jobs-unified-top-card__job-title|job-title)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  ]);
  const company = firstMatch(html, [
    /<(?:a|span|div)[^>]*class=["'][^"']*(?:topcard__org-name-link|topcard__flavor|job-details-jobs-unified-top-card__company-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span|div)>/i,
    /<meta[^>]*name=["']description["'][^>]*content=["'][^"']* at ([^"'-|]+?)(?: in| -|\|)/i,
  ]);
  const location = firstMatch(html, [
    /<(?:span|div)[^>]*class=["'][^"']*(?:topcard__flavor--bullet|job-details-jobs-unified-top-card__bullet|jobs-unified-top-card__bullet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i,
    /<meta[^>]*name=["']description["'][^>]*content=["'][^"']* in ([^"'-|]+?)(?: -|\|)/i,
  ]);
  const descriptionRaw = firstMatch(html, [
    /<(?:div|section)[^>]*class=["'][^"']*(?:show-more-less-html__markup|jobs-description-content__text|jobs-box__html-content|description__text)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
  ]);
  return { title, company, location, description: descriptionRaw };
}

export function extractLinkedInJob(input: LinkedInExtractionInput): ExtractionPayload {
  const pageHtml = input.pageHtml;
  const normalizedPageText = cleanText(pageHtml);
  const jsonLd = parseLinkedInJsonLd(pageHtml);
  const selected = parseSelectedJobSignal(pageHtml);
  const detail = parseDetailPanel(pageHtml);
  const descriptionSanitized = sanitizeDescription(detail.description ?? '');

  const title = detail.title ?? jsonLd.title ?? null;
  const company = detail.company ?? jsonLd.company ?? null;
  const location = detail.location ?? jsonLd.location ?? null;
  const description = descriptionSanitized.description || jsonLd.description || '';
  const workSetup = inferWorkSetup(`${location ?? ''} ${description}`);
  const employmentType = inferEmploymentType(description);

  const sourceConfidenceHints: string[] = [];
  const ambiguityFlags: string[] = [];
  const extractionNotes: string[] = [];

  if (selected.selectedSignal) {
    sourceConfidenceHints.push('selected_job_signal_detected');
  } else {
    sourceConfidenceHints.push('selected_job_signal_missing');
  }

  if (selected.selectedJobId) {
    sourceConfidenceHints.push('selected_job_id_found');
  }

  if (title) sourceConfidenceHints.push('detail_title_extracted');
  if (company) sourceConfidenceHints.push('detail_company_extracted');
  if (description) sourceConfidenceHints.push('detail_description_extracted');
  if (!description) ambiguityFlags.push('missing_description');

  if (selected.listTitles.length > 1) {
    sourceConfidenceHints.push('multiple_job_cards_detected');
  }

  if (selected.listTitles.length > 1 && title) {
    const matchingCards = selected.listTitles.filter((cardTitle) => titleLikelyMatches(title, cardTitle));
    if (matchingCards.length === 0) {
      ambiguityFlags.push('mixed_job_risk');
      extractionNotes.push('Selected detail title does not match any visible card titles. Adjacent-job contamination is possible.');
    }
    if (matchingCards.length > 1) {
      ambiguityFlags.push('duplicate_card_title_risk');
      extractionNotes.push('Multiple card items share the same title; selected job may not be uniquely identifiable.');
    }
  }

  if (!selected.selectedSignal && selected.listTitles.length > 0) {
    ambiguityFlags.push('selected_job_unknown');
    extractionNotes.push('LinkedIn two-pane list detected without clear selected-card marker.');
  }

  if (descriptionSanitized.contaminationMarkerFound) {
    sourceConfidenceHints.push('description_contamination_trimmed');
    ambiguityFlags.push('description_contamination_risk');
    extractionNotes.push('Description included LinkedIn recommendation/related modules and was trimmed to avoid contamination.');
  }

  const keywords = unique(
    countKeywordMatches(`${title ?? ''} ${description}`, [
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
      'ml',
      'llm',
      '.net',
      'java',
      'go',
    ]),
  );

  if (!title || !company || !description) {
    sourceConfidenceHints.push('critical_fields_incomplete');
  }

  if (!location) {
    extractionNotes.push('Location missing in top card; left as unknown signal for downstream validation.');
  }

  if (workSetup === 'unknown') {
    extractionNotes.push('Work setup not explicit; inferred as unknown to avoid false hard constraints.');
  }

  if (employmentType === 'unknown') {
    extractionNotes.push('Employment type not explicit; inferred as unknown.');
  }

  if (!title && !company && !description && normalizedPageText.length < 250) {
    ambiguityFlags.push('low_information_capture');
    extractionNotes.push('Capture appears too sparse for reliable LinkedIn extraction.');
  }

  return {
    sourceIdentifier: 'linkedin',
    sourceUrl: input.sourceUrl,
    rawCaptureContent: normalizedPageText,
    extractionCandidate: {
      title,
      company,
      location,
      workSetup,
      employmentType,
      description: description || null,
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
