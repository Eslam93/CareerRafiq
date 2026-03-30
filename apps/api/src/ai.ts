import { createHash } from 'node:crypto';
import type {
  AiArtifactReference,
  AiConsensusSummary,
  AiFieldEvidence,
  DiagnosticEvent,
  EmploymentType,
  ExtractionCandidate,
  PreferenceLevel,
  PreferenceProfile,
  Seniority,
  WorkSetup,
} from '@career-rafiq/contracts';
import type { CareerRafiqRepository, StoredAiArtifact } from '@career-rafiq/db';
import { createId, normalizeText, unique } from '@career-rafiq/core';
import type { AiFeatureFlags } from './config.js';
import { getOpenAiApiKey, getOpenAiBaseUrl, getOpenAiModel, getOpenAiTimeoutMs } from './config.js';
import { redactDiagnosticPayload } from './eye-diagnostics.js';
import { logError, logInfo } from './logging.js';
import { getRequestDiagnosticContext } from './request-context.js';

type JsonObject = Record<string, unknown>;

export interface CvProfileSuggestion {
  cvName: string | null;
  primaryRole: string | null;
  secondaryRoles: string[];
  seniority: Seniority;
  careerTrack: string | null;
  coreStack: string[];
  positioningSummary: string;
  excludedDomains: string[];
}

export interface CvFileClassification {
  isResume: boolean;
  confidence: number;
  reason: string;
  documentTypeLabel: string | null;
}

export interface PreferenceSuggestion {
  workSetupPreferences: Record<Exclude<WorkSetup, 'unknown'>, PreferenceLevel>;
  employmentTypePreferences: Record<Exclude<EmploymentType, 'unknown'>, PreferenceLevel>;
  preferredSeniorityRange: PreferenceProfile['preferredSeniorityRange'];
  scopePreferences: string[];
  preferGreenfield: boolean;
  preferHighOwnership: boolean;
  allowedOnSiteCountries: string[];
  allowedOnSiteCities: string[];
  preferredLocations: string[];
  avoidedLocations: string[];
  preferredRoleTracks: string[];
  avoidedRoleTracks: string[];
  preferredJobTitles: string[];
  avoidedJobTitles: string[];
  preferredSectors: string[];
  avoidedSectors: string[];
  preferredCompanyTypes: string[];
  avoidedCompanyTypes: string[];
  preferredKeywords: string[];
  requiredKeywords: string[];
  avoidedKeywords: string[];
}

export interface JobExtractionSuggestion {
  extractionCandidate: ExtractionCandidate;
  ambiguityFlags: string[];
  extractionNotes: string[];
  sourceOfTruthSummary: string | null;
  coherenceAssessment: {
    isSingleJob: boolean;
    confidence: number;
    note: string;
  };
}

export interface JobSignalInference {
  roleTrack: string | null;
  companySector: string | null;
  companyType: string | null;
  salientKeywords: string[];
  scopeSignals: string[];
  greenfieldSignal: boolean | null;
  highOwnershipSignal: boolean | null;
}

export interface AiRunResult<T> {
  output: T;
  overallConfidence: number;
  summary: string;
  fieldEvidence: AiFieldEvidence[];
  debug?: {
    systemPrompt: string;
    userPrompt: string;
    rawResponseText: string;
    rawResponsePayload?: unknown;
  };
}

export interface AiProvider {
  classifyCvFile(input: { fileName: string; mimeType: string | null; fileDataUrl: string }): Promise<AiRunResult<CvFileClassification>>;
  suggestCvProfile(input: { rawText: string; fileName: string }): Promise<AiRunResult<CvProfileSuggestion>>;
  suggestPreferences(input: {
    cvProfiles: Array<Pick<CvProfileSuggestion, 'primaryRole' | 'secondaryRoles' | 'seniority' | 'careerTrack' | 'coreStack' | 'excludedDomains'>>;
    currentPreferences: PreferenceProfile | null;
    positiveHistory: Array<{
      title: string | null;
      company: string | null;
      keywords: string[];
      outcome: string;
    }>;
  }): Promise<AiRunResult<PreferenceSuggestion>>;
  extractJobFallback(input: { sourceUrl: string; sourceIdentifier: string; rawCaptureContent: string }): Promise<AiRunResult<JobExtractionSuggestion>>;
  validateJobExtraction(input: {
    sourceUrl: string;
    sourceIdentifier: string;
    rawCaptureContent: string;
    extractionCandidate: ExtractionCandidate;
  }): Promise<AiRunResult<JobExtractionSuggestion>>;
  inferJobSignals(input: {
    title: string | null;
    description: string;
    company: string | null;
    companySector: string | null;
    companyType: string | null;
    keywords: string[];
  }): Promise<AiRunResult<JobSignalInference>>;
}

interface OpenAiResponseFormat {
  name: string;
  schema: JsonObject;
}

type OpenAiUserContentItem =
  | {
      type: 'input_text';
      text: string;
    }
  | {
      type: 'input_file';
      filename: string;
      file_data: string;
    };

const CV_PROMPT_PRIMARY_CHAR_LIMIT = 6000;
const CV_PROMPT_RETRY_CHAR_LIMIT = 3000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.filter((entry): entry is string => typeof entry === 'string')) : [];
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function sanitizeAiErrorMessage(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]');
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || /aborted|timed out|timeout/i.test(error.message);
}

function compactMultilineText(value: string, maxChars: number): string {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
  }

  const dedupedLines = unique(lines);
  const headBudget = Math.max(0, Math.floor(maxChars * 0.7));
  const tailBudget = Math.max(0, maxChars - headBudget - 8);
  const selectedHead: string[] = [];
  let consumedHead = 0;

  for (const line of dedupedLines) {
    const cost = line.length + 1;
    if (selectedHead.length > 0 && consumedHead + cost > headBudget) {
      break;
    }
    selectedHead.push(line);
    consumedHead += cost;
    if (consumedHead >= headBudget) {
      break;
    }
  }

  const remainingLines = dedupedLines.slice(selectedHead.length);
  if (remainingLines.length === 0) {
    return selectedHead.join('\n').slice(0, maxChars);
  }

  const selectedTail: string[] = [];
  let consumedTail = 0;
  for (let index = remainingLines.length - 1; index >= 0; index -= 1) {
    const line = remainingLines[index]!;
    const cost = line.length + 1;
    if (selectedTail.length > 0 && consumedTail + cost > tailBudget) {
      break;
    }
    selectedTail.unshift(line);
    consumedTail += cost;
    if (consumedTail >= tailBudget) {
      break;
    }
  }

  return [...selectedHead, '[...]', ...selectedTail].join('\n').slice(0, maxChars);
}

function buildCvProfileUserPrompt(fileName: string, rawText: string, maxChars: number): string {
  const excerpt = compactMultilineText(rawText, maxChars);
  return `File name: ${fileName}\n\nCV excerpt:\n${excerpt}`;
}

function preferenceLevelSchema(): JsonObject {
  return {
    type: 'string',
    enum: ['top', 'ok', 'neutral', 'not_recommended', 'hard_skip'],
  };
}

function workSetupPreferencesSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['remote', 'hybrid', 'onsite'],
    properties: {
      remote: preferenceLevelSchema(),
      hybrid: preferenceLevelSchema(),
      onsite: preferenceLevelSchema(),
    },
  };
}

function employmentTypePreferencesSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['full_time', 'part_time', 'contract', 'freelance', 'temporary', 'internship'],
    properties: {
      full_time: preferenceLevelSchema(),
      part_time: preferenceLevelSchema(),
      contract: preferenceLevelSchema(),
      freelance: preferenceLevelSchema(),
      temporary: preferenceLevelSchema(),
      internship: preferenceLevelSchema(),
    },
  };
}

function parseFieldEvidence(value: unknown): AiFieldEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const field = asString(record['field']);
      if (!field) {
        return null;
      }
      return {
        field,
        confidence: clampConfidence(record['confidence']),
        reasons: asStringArray(record['reasons']),
        evidence: asStringArray(record['evidence']),
        provenance: (asString(record['provenance']) ?? 'ai') as AiFieldEvidence['provenance'],
      } satisfies AiFieldEvidence;
    })
    .filter((entry): entry is AiFieldEvidence => Boolean(entry));
}

function normalizeWorkSetupPreferences(value: unknown): PreferenceSuggestion['workSetupPreferences'] {
  const record = asRecord(value);
  return {
    remote: (asString(record['remote']) ?? 'top') as PreferenceLevel,
    hybrid: (asString(record['hybrid']) ?? 'ok') as PreferenceLevel,
    onsite: (asString(record['onsite']) ?? 'neutral') as PreferenceLevel,
  };
}

function normalizeEmploymentTypePreferences(value: unknown): PreferenceSuggestion['employmentTypePreferences'] {
  const record = asRecord(value);
  return {
    full_time: (asString(record['full_time']) ?? 'top') as PreferenceLevel,
    part_time: (asString(record['part_time']) ?? 'neutral') as PreferenceLevel,
    contract: (asString(record['contract']) ?? 'neutral') as PreferenceLevel,
    freelance: (asString(record['freelance']) ?? 'neutral') as PreferenceLevel,
    temporary: (asString(record['temporary']) ?? 'neutral') as PreferenceLevel,
    internship: (asString(record['internship']) ?? 'neutral') as PreferenceLevel,
  };
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenAI response payload was empty.');
  }
  const record = payload as Record<string, unknown>;
  if (typeof record['output_text'] === 'string' && record['output_text'].trim().length > 0) {
    return record['output_text'];
  }
  const choices = Array.isArray(record['choices']) ? record['choices'] : [];
  const choiceContent = ((choices[0] as Record<string, unknown> | undefined)?.['message'] as Record<string, unknown> | undefined)?.['content'];
  if (typeof choiceContent === 'string' && choiceContent.trim().length > 0) {
    return choiceContent;
  }
  const output = Array.isArray(record['output']) ? record['output'] : [];
  for (const item of output) {
    const content = Array.isArray((item as Record<string, unknown>)['content'])
      ? ((item as Record<string, unknown>)['content'] as Array<Record<string, unknown>>)
      : [];
    for (const contentItem of content) {
      if (typeof contentItem['text'] === 'string' && contentItem['text'].trim().length > 0) {
        return contentItem['text'];
      }
    }
  }
  throw new Error('OpenAI response did not contain structured JSON text.');
}

function parseCvProfileSuggestion(value: unknown): AiRunResult<CvProfileSuggestion> {
  const record = asRecord(value);
  return {
    output: {
      cvName: asString(record['cvName']),
      primaryRole: asString(record['primaryRole']),
      secondaryRoles: asStringArray(record['secondaryRoles']),
      seniority: (asString(record['seniority']) ?? 'unknown') as Seniority,
      careerTrack: asString(record['careerTrack']),
      coreStack: asStringArray(record['coreStack']),
      positioningSummary: asString(record['positioningSummary']) ?? '',
      excludedDomains: asStringArray(record['excludedDomains']),
    },
    overallConfidence: clampConfidence(record['overallConfidence']),
    summary: asString(record['summary']) ?? 'AI CV profile suggestion generated.',
    fieldEvidence: parseFieldEvidence(record['fieldEvidence']),
  };
}

function parseCvFileClassification(value: unknown): AiRunResult<CvFileClassification> {
  const record = asRecord(value);
  return {
    output: {
      isResume: asBoolean(record['isResume']) ?? false,
      confidence: clampConfidence(record['confidence']),
      reason: asString(record['reason']) ?? 'No classification rationale returned.',
      documentTypeLabel: asString(record['documentTypeLabel']),
    },
    overallConfidence: clampConfidence(record['overallConfidence'] ?? record['confidence']),
    summary: asString(record['summary']) ?? 'CV file classification completed.',
    fieldEvidence: parseFieldEvidence(record['fieldEvidence']),
  };
}

function parsePreferenceSuggestion(value: unknown): AiRunResult<PreferenceSuggestion> {
  const record = asRecord(value);
  return {
    output: {
      workSetupPreferences: normalizeWorkSetupPreferences(record['workSetupPreferences']),
      employmentTypePreferences: normalizeEmploymentTypePreferences(record['employmentTypePreferences']),
      preferredSeniorityRange: {
        minimum: (asString(asRecord(record['preferredSeniorityRange'])['minimum']) ?? null) as Seniority | null,
        maximum: (asString(asRecord(record['preferredSeniorityRange'])['maximum']) ?? null) as Seniority | null,
      },
      scopePreferences: asStringArray(record['scopePreferences']),
      preferGreenfield: Boolean(record['preferGreenfield']),
      preferHighOwnership: Boolean(record['preferHighOwnership']),
      allowedOnSiteCountries: asStringArray(record['allowedOnSiteCountries']),
      allowedOnSiteCities: asStringArray(record['allowedOnSiteCities']),
      preferredLocations: asStringArray(record['preferredLocations']),
      avoidedLocations: asStringArray(record['avoidedLocations']),
      preferredRoleTracks: asStringArray(record['preferredRoleTracks']),
      avoidedRoleTracks: asStringArray(record['avoidedRoleTracks']),
      preferredJobTitles: asStringArray(record['preferredJobTitles']),
      avoidedJobTitles: asStringArray(record['avoidedJobTitles']),
      preferredSectors: asStringArray(record['preferredSectors']),
      avoidedSectors: asStringArray(record['avoidedSectors']),
      preferredCompanyTypes: asStringArray(record['preferredCompanyTypes']),
      avoidedCompanyTypes: asStringArray(record['avoidedCompanyTypes']),
      preferredKeywords: asStringArray(record['preferredKeywords']),
      requiredKeywords: asStringArray(record['requiredKeywords']),
      avoidedKeywords: asStringArray(record['avoidedKeywords']),
    },
    overallConfidence: clampConfidence(record['overallConfidence']),
    summary: asString(record['summary']) ?? 'AI preference suggestion generated.',
    fieldEvidence: parseFieldEvidence(record['fieldEvidence']),
  };
}

function classifyCvFileDeterministically(input: {
  fileName: string;
  mimeType: string | null;
  previewText: string;
}): AiRunResult<CvFileClassification> {
  const combined = normalizeText(`${input.fileName}\n${input.previewText}`);
  const positiveSignals = [
    'resume',
    'curriculum vitae',
    'cv',
    'experience',
    'work experience',
    'professional summary',
    'education',
    'skills',
    'employment history',
  ].filter((keyword) => combined.includes(normalizeText(keyword)));
  const negativeSignals = [
    'job description',
    'cover letter',
    'statement of work',
    'invoice',
    'contract terms',
    'meeting agenda',
    'offer letter',
  ].filter((keyword) => combined.includes(normalizeText(keyword)));

  const nameLooksLikeResume = /\b(cv|resume|curriculum vitae)\b/i.test(input.fileName);
  const isResume = (positiveSignals.length >= 2 || nameLooksLikeResume) && negativeSignals.length === 0;
  const confidence = Math.max(
    0.2,
    Math.min(0.92, 0.35 + positiveSignals.length * 0.14 + (nameLooksLikeResume ? 0.14 : 0) - negativeSignals.length * 0.24),
  );

  return {
    output: {
      isResume,
      confidence,
      reason: isResume
        ? `Deterministic fallback found resume-like signals: ${positiveSignals.slice(0, 4).join(', ') || 'file naming pattern'}.`
        : `Deterministic fallback did not find enough resume signals${negativeSignals.length > 0 ? ` and found non-resume indicators: ${negativeSignals.slice(0, 3).join(', ')}` : ''}.`,
      documentTypeLabel: isResume ? 'resume' : (negativeSignals[0] ?? 'unknown_document'),
    },
    overallConfidence: confidence,
    summary: isResume ? 'Deterministic fallback classified the file as a resume.' : 'Deterministic fallback rejected the file as a non-resume.',
    fieldEvidence: [
      {
        field: 'isResume',
        confidence,
        reasons: isResume
          ? ['Resume-like sections or naming patterns were present.']
          : ['Resume-like evidence was too weak or contradicted by non-resume indicators.'],
        evidence: [...positiveSignals.slice(0, 4), ...negativeSignals.slice(0, 3)],
        provenance: 'deterministic',
      },
    ],
  };
}

function jobExtractionSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['extractionCandidate', 'ambiguityFlags', 'extractionNotes', 'sourceOfTruthSummary', 'coherenceAssessment', 'summary', 'overallConfidence', 'fieldEvidence'],
    properties: {
      extractionCandidate: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'company', 'location', 'workSetup', 'employmentType', 'description', 'recruiterOrPosterSignal', 'companySector', 'companyType', 'keywords'],
        properties: {
          title: { type: ['string', 'null'] },
          company: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          workSetup: { type: 'string' },
          employmentType: { type: 'string' },
          description: { type: ['string', 'null'] },
          recruiterOrPosterSignal: { type: ['string', 'null'] },
          companySector: { type: ['string', 'null'] },
          companyType: { type: ['string', 'null'] },
          keywords: { type: 'array', items: { type: 'string' } },
        },
      },
      ambiguityFlags: { type: 'array', items: { type: 'string' } },
      extractionNotes: { type: 'array', items: { type: 'string' } },
      sourceOfTruthSummary: { type: ['string', 'null'] },
      coherenceAssessment: {
        type: 'object',
        additionalProperties: false,
        required: ['isSingleJob', 'confidence', 'note'],
        properties: {
          isSingleJob: { type: 'boolean' },
          confidence: { type: 'number' },
          note: { type: 'string' },
        },
      },
      summary: { type: 'string' },
      overallConfidence: { type: 'number' },
      fieldEvidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'confidence', 'reasons', 'evidence', 'provenance'],
          properties: {
            field: { type: 'string' },
            confidence: { type: 'number' },
            reasons: { type: 'array', items: { type: 'string' } },
            evidence: { type: 'array', items: { type: 'string' } },
            provenance: { type: 'string' },
          },
        },
      },
    },
  };
}

function parseJobExtractionSuggestion(value: unknown): AiRunResult<JobExtractionSuggestion> {
  const record = asRecord(value);
  const candidate = asRecord(record['extractionCandidate']);
  return {
    output: {
      extractionCandidate: {
        title: asString(candidate['title']),
        company: asString(candidate['company']),
        location: asString(candidate['location']),
        workSetup: (asString(candidate['workSetup']) ?? 'unknown') as ExtractionCandidate['workSetup'],
        employmentType: (asString(candidate['employmentType']) ?? 'unknown') as ExtractionCandidate['employmentType'],
        description: asString(candidate['description']),
        recruiterOrPosterSignal: asString(candidate['recruiterOrPosterSignal']),
        companySector: asString(candidate['companySector']),
        companyType: asString(candidate['companyType']),
        keywords: asStringArray(candidate['keywords']),
      },
      ambiguityFlags: asStringArray(record['ambiguityFlags']),
      extractionNotes: asStringArray(record['extractionNotes']),
      sourceOfTruthSummary: asString(record['sourceOfTruthSummary']),
      coherenceAssessment: {
        isSingleJob: asBoolean(asRecord(record['coherenceAssessment'])['isSingleJob']) ?? false,
        confidence: clampConfidence(asRecord(record['coherenceAssessment'])['confidence']),
        note: asString(asRecord(record['coherenceAssessment'])['note']) ?? 'AI coherence review completed.',
      },
    },
    overallConfidence: clampConfidence(record['overallConfidence']),
    summary: asString(record['summary']) ?? 'AI extraction suggestion generated.',
    fieldEvidence: parseFieldEvidence(record['fieldEvidence']),
  };
}

function parseJobSignalInference(value: unknown): AiRunResult<JobSignalInference> {
  const record = asRecord(value);
  return {
    output: {
      roleTrack: asString(record['roleTrack']),
      companySector: asString(record['companySector']),
      companyType: asString(record['companyType']),
      salientKeywords: asStringArray(record['salientKeywords']),
      scopeSignals: asStringArray(record['scopeSignals']),
      greenfieldSignal: asBoolean(record['greenfieldSignal']),
      highOwnershipSignal: asBoolean(record['highOwnershipSignal']),
    },
    overallConfidence: clampConfidence(record['overallConfidence']),
    summary: asString(record['summary']) ?? 'AI signal inference generated.',
    fieldEvidence: parseFieldEvidence(record['fieldEvidence']),
  };
}

export class OpenAiProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  classifyCvFile(input: { fileName: string; mimeType: string | null; fileDataUrl: string }): Promise<AiRunResult<CvFileClassification>> {
    return this.requestStructuredJson<CvFileClassification>(
      {
        name: 'cv_file_classification',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['isResume', 'confidence', 'reason', 'documentTypeLabel', 'summary', 'overallConfidence', 'fieldEvidence'],
          properties: {
            isResume: { type: 'boolean' },
            confidence: { type: 'number' },
            reason: { type: 'string' },
            documentTypeLabel: { type: ['string', 'null'] },
            summary: { type: 'string' },
            overallConfidence: { type: 'number' },
            fieldEvidence: fieldEvidenceArraySchema(),
          },
        },
      },
      'You classify uploaded files for a job-fit product. Decide whether the uploaded file is a CV or resume. Return strict JSON only.',
      [
        {
          type: 'input_text',
          text: `Classify this uploaded file. File name: ${input.fileName}\nMime type: ${input.mimeType ?? 'unknown'}`,
        },
        {
          type: 'input_file',
          filename: input.fileName,
          file_data: input.fileDataUrl,
        },
      ],
      parseCvFileClassification,
    );
  }

  suggestCvProfile(input: { rawText: string; fileName: string }): Promise<AiRunResult<CvProfileSuggestion>> {
    const format: OpenAiResponseFormat = {
      name: 'cv_profile_suggestion',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['cvName', 'primaryRole', 'secondaryRoles', 'seniority', 'careerTrack', 'coreStack', 'positioningSummary', 'excludedDomains', 'summary', 'overallConfidence', 'fieldEvidence'],
        properties: {
          cvName: { type: ['string', 'null'] },
          primaryRole: { type: ['string', 'null'] },
          secondaryRoles: { type: 'array', items: { type: 'string' } },
          seniority: { type: 'string' },
          careerTrack: { type: ['string', 'null'] },
          coreStack: { type: 'array', items: { type: 'string' } },
          positioningSummary: { type: 'string' },
          excludedDomains: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          overallConfidence: { type: 'number' },
          fieldEvidence: fieldEvidenceArraySchema(),
        },
      },
    };
    const systemPrompt = 'You generate structured CV positioning suggestions for a job-fit product. Return strict JSON only.';
    const primaryPrompt = buildCvProfileUserPrompt(input.fileName, input.rawText, CV_PROMPT_PRIMARY_CHAR_LIMIT);
    const retryPrompt = buildCvProfileUserPrompt(input.fileName, input.rawText, CV_PROMPT_RETRY_CHAR_LIMIT);

    return this.requestJson<CvProfileSuggestion>(
      format,
      systemPrompt,
      primaryPrompt,
      parseCvProfileSuggestion,
    ).catch((error) => {
      if (!isAbortLikeError(error)) {
        throw error;
      }
      logInfo('ai.retrying', {
        stepType: 'cv_profile_suggestion',
        retryStrategy: 'compact_prompt_after_timeout',
      });
      return this.requestJson<CvProfileSuggestion>(
        format,
        systemPrompt,
        retryPrompt,
        parseCvProfileSuggestion,
      );
    });
  }

  suggestPreferences(input: {
    cvProfiles: Array<Pick<CvProfileSuggestion, 'primaryRole' | 'secondaryRoles' | 'seniority' | 'careerTrack' | 'coreStack' | 'excludedDomains'>>;
    currentPreferences: PreferenceProfile | null;
    positiveHistory: Array<{
      title: string | null;
      company: string | null;
      keywords: string[];
      outcome: string;
    }>;
  }): Promise<AiRunResult<PreferenceSuggestion>> {
    return this.requestJson<PreferenceSuggestion>(
      {
        name: 'preference_suggestion',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: [
            'workSetupPreferences',
            'employmentTypePreferences',
            'preferredSeniorityRange',
            'scopePreferences',
            'preferGreenfield',
            'preferHighOwnership',
            'allowedOnSiteCountries',
            'allowedOnSiteCities',
            'preferredLocations',
            'avoidedLocations',
            'preferredRoleTracks',
            'avoidedRoleTracks',
            'preferredJobTitles',
            'avoidedJobTitles',
            'preferredSectors',
            'avoidedSectors',
            'preferredCompanyTypes',
            'avoidedCompanyTypes',
            'preferredKeywords',
            'requiredKeywords',
            'avoidedKeywords',
            'summary',
            'overallConfidence',
            'fieldEvidence',
          ],
          properties: {
            workSetupPreferences: workSetupPreferencesSchema(),
            employmentTypePreferences: employmentTypePreferencesSchema(),
            preferredSeniorityRange: {
              type: 'object',
              additionalProperties: false,
              required: ['minimum', 'maximum'],
              properties: {
                minimum: { type: ['string', 'null'] },
                maximum: { type: ['string', 'null'] },
              },
            },
            scopePreferences: { type: 'array', items: { type: 'string' } },
            preferGreenfield: { type: 'boolean' },
            preferHighOwnership: { type: 'boolean' },
            allowedOnSiteCountries: { type: 'array', items: { type: 'string' } },
            allowedOnSiteCities: { type: 'array', items: { type: 'string' } },
            preferredLocations: { type: 'array', items: { type: 'string' } },
            avoidedLocations: { type: 'array', items: { type: 'string' } },
            preferredRoleTracks: { type: 'array', items: { type: 'string' } },
            avoidedRoleTracks: { type: 'array', items: { type: 'string' } },
            preferredJobTitles: { type: 'array', items: { type: 'string' } },
            avoidedJobTitles: { type: 'array', items: { type: 'string' } },
            preferredSectors: { type: 'array', items: { type: 'string' } },
            avoidedSectors: { type: 'array', items: { type: 'string' } },
            preferredCompanyTypes: { type: 'array', items: { type: 'string' } },
            avoidedCompanyTypes: { type: 'array', items: { type: 'string' } },
            preferredKeywords: { type: 'array', items: { type: 'string' } },
            requiredKeywords: { type: 'array', items: { type: 'string' } },
            avoidedKeywords: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
            overallConfidence: { type: 'number' },
            fieldEvidence: fieldEvidenceArraySchema(),
          },
        },
      },
      'You generate structured job-search preferences from CV positioning and positive tracker history. Return strict JSON only.',
      JSON.stringify(input),
      parsePreferenceSuggestion,
    );
  }

  extractJobFallback(input: { sourceUrl: string; sourceIdentifier: string; rawCaptureContent: string }): Promise<AiRunResult<JobExtractionSuggestion>> {
    return this.requestJson<JobExtractionSuggestion>(
      {
        name: 'job_extraction_fallback',
        schema: jobExtractionSchema(),
      },
      'You extract a single coherent job from noisy captured page content. Return strict JSON only.',
      `Source: ${input.sourceIdentifier}\nURL: ${input.sourceUrl}\n\nPage content:\n${input.rawCaptureContent.slice(0, 16000)}`,
      parseJobExtractionSuggestion,
    );
  }

  validateJobExtraction(input: {
    sourceUrl: string;
    sourceIdentifier: string;
    rawCaptureContent: string;
    extractionCandidate: ExtractionCandidate;
  }): Promise<AiRunResult<JobExtractionSuggestion>> {
    return this.requestJson<JobExtractionSuggestion>(
      {
        name: 'job_extraction_validation',
        schema: jobExtractionSchema(),
      },
      'You validate whether an extracted job candidate is coherent and correct relative to captured page content. Return strict JSON only.',
      JSON.stringify(input),
      parseJobExtractionSuggestion,
    );
  }

  inferJobSignals(input: {
    title: string | null;
    description: string;
    company: string | null;
    companySector: string | null;
    companyType: string | null;
    keywords: string[];
  }): Promise<AiRunResult<JobSignalInference>> {
    return this.requestJson<JobSignalInference>(
      {
        name: 'job_signal_inference',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['roleTrack', 'companySector', 'companyType', 'salientKeywords', 'scopeSignals', 'greenfieldSignal', 'highOwnershipSignal', 'summary', 'overallConfidence', 'fieldEvidence'],
          properties: {
            roleTrack: { type: ['string', 'null'] },
            companySector: { type: ['string', 'null'] },
            companyType: { type: ['string', 'null'] },
            salientKeywords: { type: 'array', items: { type: 'string' } },
            scopeSignals: { type: 'array', items: { type: 'string' } },
            greenfieldSignal: { type: ['boolean', 'null'] },
            highOwnershipSignal: { type: ['boolean', 'null'] },
            summary: { type: 'string' },
            overallConfidence: { type: 'number' },
            fieldEvidence: fieldEvidenceArraySchema(),
          },
        },
      },
      'You infer lightweight job signals only when evidence is strong enough from the provided job content. Return strict JSON only.',
      JSON.stringify(input),
      parseJobSignalInference,
    );
  }

  private async requestJson<T>(
    format: OpenAiResponseFormat,
    systemPrompt: string,
    userPrompt: string,
    parser: (value: unknown) => AiRunResult<T>,
  ): Promise<AiRunResult<T>> {
    return this.requestStructuredJson(format, systemPrompt, [{ type: 'input_text', text: userPrompt }], parser);
  }

  private async requestStructuredJson<T>(
    format: OpenAiResponseFormat,
    systemPrompt: string,
    userContent: OpenAiUserContentItem[],
    parser: (value: unknown) => AiRunResult<T>,
  ): Promise<AiRunResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          model: this.model,
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: systemPrompt }],
            },
            {
              role: 'user',
              content: userContent,
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: format.name,
              schema: format.schema,
              strict: true,
            },
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`OpenAI request failed with status ${response.status}: ${JSON.stringify(payload)}`);
      }
      const rawResponseText = extractResponseText(payload);
      return {
        ...parser(JSON.parse(rawResponseText)),
        debug: {
          systemPrompt,
          userPrompt: userContent
            .map((entry) =>
              entry.type === 'input_text'
                ? entry.text
                : `[input_file ${entry.filename}]`,
            )
            .join('\n\n'),
          rawResponseText,
          rawResponsePayload: payload,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function fieldEvidenceArraySchema(): JsonObject {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'confidence', 'reasons', 'evidence', 'provenance'],
      properties: {
        field: { type: 'string' },
        confidence: { type: 'number' },
        reasons: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
        provenance: { type: 'string' },
      },
    },
  };
}

function hashInput(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toArtifactReference(record: StoredAiArtifact): AiArtifactReference {
  return {
    id: record.id,
    stepType: record.stepType,
    status: record.status,
    provider: record.provider,
    model: record.model,
    promptVersion: record.promptVersion,
    overallConfidence: record.overallConfidence,
    createdAt: record.createdAt,
  };
}

function recordAiDiagnosticEvent(
  repository: CareerRafiqRepository,
  clock: () => Date,
  input: {
    userId: string | null;
    relatedEntityId: string;
    stepType: StoredAiArtifact['stepType'];
    promptVersion: string;
    model: string;
    artifactId: string;
    severity: DiagnosticEvent['severity'];
    code: string;
    summary: string;
    payload: Record<string, unknown>;
  },
): void {
  const requestContext = getRequestDiagnosticContext();
  const eyeSessionId = requestContext?.eyeSessionId ?? null;
  if (!eyeSessionId) {
    return;
  }
  repository.saveDiagnosticEvent({
    id: createId('diag'),
    eyeSessionId,
    requestId: requestContext?.requestId ?? null,
    userId: input.userId,
    jobId:
      input.stepType === 'job_extraction_fallback' || input.stepType === 'job_extraction_validation'
        ? input.relatedEntityId
        : null,
    trackerItemId: null,
    area: 'ai',
    stage: input.stepType,
    code: input.code,
    severity: input.severity,
    summary: input.summary,
    payload: redactDiagnosticPayload({
      artifactId: input.artifactId,
      promptVersion: input.promptVersion,
      model: input.model,
      ...input.payload,
    }) as Record<string, unknown>,
    createdAt: clock().toISOString(),
  });
}

export class AiOrchestrator {
  private readonly provider: AiProvider | null;

  private readonly model: string;

  constructor(
    private readonly repository: CareerRafiqRepository,
    private readonly clock: () => Date,
    private readonly featureFlags: AiFeatureFlags,
    provider?: AiProvider | null,
  ) {
    this.model = getOpenAiModel();
    if (typeof provider !== 'undefined') {
      this.provider = provider;
      return;
    }
    const apiKey = getOpenAiApiKey();
    this.provider = apiKey
      ? new OpenAiProvider(apiKey, getOpenAiBaseUrl(), this.model, getOpenAiTimeoutMs())
      : null;
  }

  getFlags(): AiFeatureFlags {
    return this.featureFlags;
  }

  isProviderConfigured(): boolean {
    return this.provider !== null;
  }

  isFeatureEnabled(feature: keyof AiFeatureFlags): boolean {
    return this.featureFlags[feature] && this.provider !== null;
  }

  async classifyCvFile(
    userId: string | null,
    relatedEntityId: string,
    input: { fileName: string; mimeType: string | null; buffer: Buffer },
  ): Promise<{ output: CvFileClassification; artifact: StoredAiArtifact | null; artifactReference: AiArtifactReference | null }> {
    const promptVersion = 'cv-file-classification-v1';
    const fileHash = createHash('sha256').update(input.buffer).digest('hex');
    const inputMeta = {
      fileHash,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.buffer.length,
    } satisfies JsonObject;
    const providerKind = this.provider ? 'openai' : 'deterministic';
    const modelName = this.provider ? this.model : 'deterministic-classifier';
    const cacheKey = `cv_file_classification:${modelName}:${promptVersion}:${hashInput(inputMeta)}`;

    if (userId) {
      const cached = this.repository.getAiArtifactByCacheKey(cacheKey);
      if (cached?.status === 'completed') {
        recordAiDiagnosticEvent(this.repository, this.clock, {
          userId,
          relatedEntityId,
          stepType: 'cv_file_classification',
          promptVersion,
          model: modelName,
          artifactId: cached.id,
          severity: 'info',
          code: 'ai_step_cache_hit',
          summary: 'CV file classification returned a cached artifact.',
          payload: {
            cacheKey,
            input: inputMeta,
            output: cached.rawOutput,
            overallConfidence: cached.overallConfidence,
            summary: cached.summary,
            fieldEvidence: cached.fieldEvidence,
          },
        });
        return {
          output: cached.rawOutput as unknown as CvFileClassification,
          artifact: cached,
          artifactReference: toArtifactReference(cached),
        };
      }
    }

    const previewText = input.buffer.toString('utf8').slice(0, 6000);
    let result: AiRunResult<CvFileClassification>;
    let artifactProvider: StoredAiArtifact['provider'] = providerKind;
    let artifactModel: string | null = this.provider ? this.model : null;

    if (this.provider) {
      try {
        result = await this.provider.classifyCvFile({
          fileName: input.fileName,
          mimeType: input.mimeType ?? null,
          fileDataUrl: `data:${input.mimeType ?? 'application/octet-stream'};base64,${input.buffer.toString('base64')}`,
        });
      } catch (error) {
        const message = sanitizeAiErrorMessage(error instanceof Error ? error.message : 'Unknown CV classification failure.');
        recordAiDiagnosticEvent(this.repository, this.clock, {
          userId,
          relatedEntityId,
          stepType: 'cv_file_classification',
          promptVersion,
          model: this.model,
          artifactId: 'ephemeral',
          severity: 'error',
          code: 'ai_step_failed',
          summary: 'CV file classification failed and fell back to deterministic classification.',
          payload: {
            input: inputMeta,
            error: message,
          },
        });
        result = classifyCvFileDeterministically({
          fileName: input.fileName,
          mimeType: input.mimeType ?? null,
          previewText,
        });
        artifactProvider = 'deterministic';
        artifactModel = null;
      }
    } else {
      result = classifyCvFileDeterministically({
        fileName: input.fileName,
        mimeType: input.mimeType ?? null,
        previewText,
      });
    }

    const artifactCacheKey = `cv_file_classification:${artifactProvider === 'openai' ? this.model : 'deterministic-classifier'}:${promptVersion}:${hashInput(inputMeta)}`;
    const now = this.clock().toISOString();
    const artifact = userId
      ? this.repository.saveAiArtifact({
          id: createId('aia'),
          userId,
          stepType: 'cv_file_classification',
          relatedEntityType: 'cv',
          relatedEntityId,
          status: 'completed',
          provider: artifactProvider,
          model: artifactModel,
          promptVersion,
          inputHash: hashInput(inputMeta),
          cacheKey: artifactCacheKey,
          overallConfidence: result.overallConfidence,
          summary: result.summary,
          rawOutput: result.output as unknown as Record<string, unknown>,
          fieldEvidence: result.fieldEvidence,
          consensus: null,
          createdAt: now,
          updatedAt: now,
        })
      : null;

    recordAiDiagnosticEvent(this.repository, this.clock, {
      userId,
      relatedEntityId,
      stepType: 'cv_file_classification',
      promptVersion,
      model: artifactProvider === 'openai' ? this.model : 'deterministic-classifier',
      artifactId: artifact?.id ?? 'ephemeral',
      severity: 'info',
      code: 'ai_step_completed',
      summary: 'CV file classification completed successfully.',
      payload: {
        input: inputMeta,
        output: result.output,
        overallConfidence: result.overallConfidence,
        summary: result.summary,
        fieldEvidence: result.fieldEvidence,
        debug: result.debug ?? null,
      },
    });

    return {
      output: result.output,
      artifact,
      artifactReference: artifact ? toArtifactReference(artifact) : null,
    };
  }

  async suggestCvProfile(userId: string, cvProfileId: string, input: { rawText: string; fileName: string; triggerReasons?: string[] }) {
    return this.runStep(
      'aiSetupSuggestions',
      'cv_profile_suggestion',
      'cv_profile',
      cvProfileId,
      input,
      'cv-profile-v1',
      (payload) => this.provider!.suggestCvProfile(payload),
      (result) => {
        if (!this.featureFlags.aiConsensus) {
          return [];
        }
        return unique([...(input.triggerReasons ?? []), ...(result.overallConfidence < 0.72 ? ['low_confidence'] : [])]).filter(Boolean);
      },
      userId,
    );
  }

  async suggestPreferences(
    userId: string,
    preferenceProfileId: string,
    input: {
      cvProfiles: Array<Pick<CvProfileSuggestion, 'primaryRole' | 'secondaryRoles' | 'seniority' | 'careerTrack' | 'coreStack' | 'excludedDomains'>>;
      currentPreferences: PreferenceProfile | null;
      positiveHistory: Array<{ title: string | null; company: string | null; keywords: string[]; outcome: string }>;
    },
  ) {
    return this.runStep(
      'aiSetupSuggestions',
      'preference_suggestion',
      'preference_profile',
      preferenceProfileId,
      input,
      'preferences-v1',
      (payload) => this.provider!.suggestPreferences(payload),
      () => [],
      userId,
    );
  }

  async extractJobFallback(userId: string, jobId: string, input: { sourceUrl: string; sourceIdentifier: string; rawCaptureContent: string }) {
    return this.runStep(
      'aiExtractionFallback',
      'job_extraction_fallback',
      'job',
      jobId,
      input,
      'job-extraction-v1',
      (payload) => this.provider!.extractJobFallback(payload),
      (result) => (this.featureFlags.aiConsensus && result.overallConfidence < 0.72 ? ['low_confidence_extraction'] : []),
      userId,
    );
  }

  async validateJobExtraction(
    userId: string,
    jobId: string,
    input: { sourceUrl: string; sourceIdentifier: string; rawCaptureContent: string; extractionCandidate: ExtractionCandidate },
  ) {
    return this.runStep(
      'aiExtractionFallback',
      'job_extraction_validation',
      'job',
      jobId,
      input,
      'job-validation-v1',
      (payload) => this.provider!.validateJobExtraction(payload),
      (result) => (this.featureFlags.aiConsensus && (!result.output.coherenceAssessment.isSingleJob || result.overallConfidence < 0.7) ? ['coherence_validation'] : []),
      userId,
    );
  }

  async inferJobSignals(
    userId: string,
    evaluationId: string,
    input: { title: string | null; description: string; company: string | null; companySector: string | null; companyType: string | null; keywords: string[] },
  ) {
    return this.runStep(
      'aiSignalInference',
      'job_signal_inference',
      'evaluation',
      evaluationId,
      input,
      'signal-inference-v1',
      (payload) => this.provider!.inferJobSignals(payload),
      (result) => (this.featureFlags.aiConsensus && result.overallConfidence < 0.7 ? ['material_signal_low_confidence'] : []),
      userId,
    );
  }

  private async runStep<T, TInput extends JsonObject>(
    feature: keyof AiFeatureFlags,
    stepType: StoredAiArtifact['stepType'],
    relatedEntityType: StoredAiArtifact['relatedEntityType'],
    relatedEntityId: string,
    input: TInput,
    promptVersion: string,
    invoke: (payload: TInput) => Promise<AiRunResult<T>>,
    consensusTrigger: (result: AiRunResult<T>) => string[],
    userId: string,
  ): Promise<{ output: T; artifact: StoredAiArtifact; artifactReference: AiArtifactReference } | null> {
    if (!this.isFeatureEnabled(feature)) {
      return null;
    }

    const inputHash = hashInput(input);
    const cacheKey = `${stepType}:${this.model}:${promptVersion}:${inputHash}`;
    const cached = this.repository.getAiArtifactByCacheKey(cacheKey);
    if (cached?.status === 'completed') {
      logInfo('ai.cache_hit', { stepType, relatedEntityId, cacheKey });
      recordAiDiagnosticEvent(this.repository, this.clock, {
        userId,
        relatedEntityId,
        stepType,
        promptVersion,
        model: this.model,
        artifactId: cached.id,
        severity: 'info',
        code: 'ai_step_cache_hit',
        summary: 'AI step returned a cached artifact.',
        payload: {
          relatedEntityType,
          cacheKey,
          overallConfidence: cached.overallConfidence,
          summary: cached.summary,
          fieldEvidence: cached.fieldEvidence,
          rawOutput: cached.rawOutput,
          consensus: cached.consensus,
        },
      });
      return {
        output: cached.rawOutput as T,
        artifact: cached,
        artifactReference: toArtifactReference(cached),
      };
    }

    const startedAt = Date.now();
    try {
      const firstRun = await invoke(input);
      const runs = [firstRun];
      const triggers = consensusTrigger(firstRun);
      let selected = firstRun;
      let selectedRunIndex = 0;
      let consensus: AiConsensusSummary = {
        enabled: triggers.length > 0,
        strategy: triggers.length > 0 ? 'multi_run_consensus' : 'single_run',
        runs: 1,
        agreement: 'single_run',
        triggeredBy: triggers,
      };

      if (triggers.length > 0) {
        const secondRun = await invoke(input);
        runs.push(secondRun);
        consensus = {
          enabled: true,
          strategy: 'multi_run_consensus',
          runs: 2,
          agreement: JSON.stringify(firstRun.output) === JSON.stringify(secondRun.output)
            ? 'strong'
            : Math.abs(firstRun.overallConfidence - secondRun.overallConfidence) < 0.08
              ? 'mixed'
              : 'low',
          triggeredBy: triggers,
        };
        if (
          secondRun.overallConfidence > firstRun.overallConfidence ||
          (secondRun.overallConfidence === firstRun.overallConfidence && JSON.stringify(secondRun.output) < JSON.stringify(firstRun.output))
        ) {
          selected = secondRun;
          selectedRunIndex = 1;
        }
      }

      const now = this.clock().toISOString();
      const artifact: StoredAiArtifact = {
        id: createId('aia'),
        userId,
        stepType,
        relatedEntityType,
        relatedEntityId,
        status: 'completed',
        provider: 'openai',
        model: this.model,
        promptVersion,
        inputHash,
        cacheKey,
        overallConfidence: selected.overallConfidence,
        summary: selected.summary,
        rawOutput: selected.output as Record<string, unknown>,
        fieldEvidence: selected.fieldEvidence,
        consensus,
        createdAt: now,
        updatedAt: now,
      };
      this.repository.saveAiArtifact(artifact);
      recordAiDiagnosticEvent(this.repository, this.clock, {
        userId,
        relatedEntityId,
        stepType,
        promptVersion,
        model: this.model,
        artifactId: artifact.id,
        severity: 'info',
        code: 'ai_step_completed',
        summary: 'AI step completed successfully.',
        payload: {
          relatedEntityType,
          input,
          selectedRunIndex,
          output: selected.output,
          overallConfidence: selected.overallConfidence,
          summary: selected.summary,
          fieldEvidence: selected.fieldEvidence,
          consensus,
          runs: runs.map((run) => ({
            overallConfidence: run.overallConfidence,
            summary: run.summary,
            fieldEvidence: run.fieldEvidence,
            output: run.output,
            debug: run.debug ?? null,
          })),
        },
      });
      logInfo('ai.completed', {
        stepType,
        relatedEntityId,
        latencyMs: Date.now() - startedAt,
        confidence: artifact.overallConfidence,
        cached: false,
        consensusRuns: artifact.consensus?.runs ?? 1,
      });
      return {
        output: selected.output,
        artifact,
        artifactReference: toArtifactReference(artifact),
      };
    } catch (error) {
      const now = this.clock().toISOString();
      const message = sanitizeAiErrorMessage(error instanceof Error ? error.message : 'Unknown AI failure.');
      const failureArtifact: StoredAiArtifact = {
        id: createId('aia'),
        userId,
        stepType,
        relatedEntityType,
        relatedEntityId,
        status: 'failed',
        provider: this.provider ? 'openai' : 'disabled',
        model: this.provider ? this.model : null,
        promptVersion,
        inputHash,
        cacheKey,
        overallConfidence: 0,
        summary: message,
        rawOutput: { error: message },
        fieldEvidence: [],
        consensus: null,
        createdAt: now,
        updatedAt: now,
      };
      this.repository.saveAiArtifact(failureArtifact);
      recordAiDiagnosticEvent(this.repository, this.clock, {
        userId,
        relatedEntityId,
        stepType,
        promptVersion,
        model: this.model,
        artifactId: failureArtifact.id,
        severity: 'error',
        code: 'ai_step_failed',
        summary: 'AI step failed.',
        payload: {
          relatedEntityType,
          input,
          error: message,
        },
      });
      logError('ai.failed', {
        stepType,
        relatedEntityId,
        latencyMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return null;
    }
  }
}

export function collectArtifactReferences(artifacts: Array<{ artifactReference: AiArtifactReference } | null | undefined>): AiArtifactReference[] {
  return artifacts
    .map((entry) => entry?.artifactReference ?? null)
    .filter((entry): entry is AiArtifactReference => Boolean(entry));
}

export function shouldRunAiExtractionFallback(args: {
  sourceIdentifier: string;
  validationStatus: string;
  ambiguityFlags: string[];
  missingCriticalFields: string[];
}): boolean {
  return (
    args.sourceIdentifier === 'manual' ||
    args.sourceIdentifier === 'unsupported' ||
    args.validationStatus !== 'proceed' ||
    args.ambiguityFlags.length > 0 ||
    args.missingCriticalFields.length > 0
  );
}

export function mergeExtractionCandidates(
  deterministic: ExtractionCandidate,
  ai: JobExtractionSuggestion['extractionCandidate'],
  deterministicConfidence: number,
): {
  candidate: ExtractionCandidate;
  fieldEvidence: AiFieldEvidence[];
  mergedFieldProvenance: Record<string, AiFieldEvidence['provenance']>;
  conflicts: string[];
} {
  const merged: ExtractionCandidate = {
    ...deterministic,
  };
  const conflicts: string[] = [];
  const mergedFieldProvenance: Record<string, AiFieldEvidence['provenance']> = {};
  const fieldEvidence: AiFieldEvidence[] = [];

  for (const field of ['title', 'company', 'location', 'workSetup', 'employmentType', 'description', 'recruiterOrPosterSignal', 'companySector', 'companyType'] as const) {
    const deterministicValue = deterministic[field];
    const aiValue = ai[field];
    if (!deterministicValue && aiValue) {
      (merged as unknown as Record<string, unknown>)[field] = aiValue;
      mergedFieldProvenance[field] = 'ai';
      fieldEvidence.push({
        field,
        confidence: 0.72,
        reasons: ['AI supplied a missing field from ambiguous or incomplete capture content.'],
        evidence: typeof aiValue === 'string' ? [aiValue] : [String(aiValue)],
        provenance: 'ai',
      });
      continue;
    }
    if (deterministicValue && aiValue && normalizeText(String(deterministicValue)) !== normalizeText(String(aiValue))) {
      if (deterministicConfidence < 0.7) {
        (merged as unknown as Record<string, unknown>)[field] = aiValue;
        mergedFieldProvenance[field] = 'merged';
        fieldEvidence.push({
          field,
          confidence: 0.66,
          reasons: ['Low-confidence deterministic extraction was replaced by the AI-assisted fallback.'],
          evidence: [String(aiValue)],
          provenance: 'merged',
        });
      } else {
        conflicts.push(field);
        mergedFieldProvenance[field] = 'deterministic';
      }
      continue;
    }
    mergedFieldProvenance[field] = 'deterministic';
  }

  const deterministicKeywords = new Set(deterministic.keywords.map((value) => normalizeText(value)));
  const mergedKeywords = unique([...deterministic.keywords, ...ai.keywords.filter((keyword) => !deterministicKeywords.has(normalizeText(keyword)))]);
  if (mergedKeywords.length !== deterministic.keywords.length) {
    merged.keywords = mergedKeywords;
    mergedFieldProvenance['keywords'] = 'merged';
    fieldEvidence.push({
      field: 'keywords',
      confidence: 0.68,
      reasons: ['AI added supplementary keywords from the captured job description.'],
      evidence: mergedKeywords,
      provenance: 'merged',
    });
  } else {
    mergedFieldProvenance['keywords'] = 'deterministic';
  }

  return {
    candidate: merged,
    fieldEvidence,
    mergedFieldProvenance,
    conflicts,
  };
}

export function buildSetupArtifactSummaries(repository: CareerRafiqRepository, cvProfileIds: string[], preferenceProfileId: string | null): AiArtifactReference[] {
  const records = [
    ...cvProfileIds.flatMap((id) => repository.listAiArtifactsByEntity('cv_profile', id)),
    ...(preferenceProfileId ? repository.listAiArtifactsByEntity('preference_profile', preferenceProfileId) : []),
  ];
  return records.map((record) => toArtifactReference(record));
}
