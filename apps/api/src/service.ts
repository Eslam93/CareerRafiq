import { createHash, randomBytes } from 'node:crypto';
import { AnalyticsEventNames } from '@career-rafiq/contracts';
import type {
  AiConsensusSummary,
  AiArtifactReference,
  AnalyzeCvUploadResponse,
  AnalyticsEventName,
  AuthSessionResponse,
  CommitCvUploadResponse,
  CV,
  DiagnosticArea,
  DiagnosticEventResponse,
  DiagnosticEventsResponse,
  CvDetailResponse,
  CvDocumentClassification,
  CvListResponse,
  CvMatchCandidate,
  CvUploadAnalysisResult,
  CvUploadCommitDecision,
  CVProfile,
  CVVersion,
  CaptureJobResponse,
  CaptureManualJobRequest,
  CapturePageRequest,
  CapturePageResponse,
  EyeCurrentResponse,
  EyeSessionResponse,
  EyeSessionsResponse,
  EvaluationResult,
  EvaluateJobResponse,
  ExtractPageRequest,
  ExtractPageResponse,
  Job,
  JobReviewResponse,
  ListDiagnosticEventsRequest,
  LogoutResponse,
  MagicLinkConsumeResponse,
  MagicLinkRequestRequest,
  MagicLinkRequestResponse,
  OpsSummaryResponse,
  PreferenceProfile,
  RecordClientDiagnosticEventRequest,
  RecordClientDiagnosticEventResponse,
  ResolveTrackerDuplicateRequest,
  ResolveTrackerDuplicateResponse,
  RuntimeDetailResponse,
  RuntimeReadinessResponse,
  SetDefaultCvResponse,
  StartEyeSessionRequest,
  SetupBootstrapResponse,
  SetupCurrentResponse,
  TrackAnalyticsEventRequest,
  TrackAnalyticsEventResponse,
  TrackerDetailResponse,
  TrackerListResponse,
  TrackerItem,
  TrackerStatus,
  UpdateTrackerRecommendationRequest,
  UpdateTrackerRecommendationResponse,
  UpdateTrackerVerdictRequest,
  UpdateTrackerVerdictResponse,
  UpdateCvProfileRequest,
  UpdateCvProfileResponse,
  UpdateJobReviewRequest,
  UpdatePreferencesRequest,
  UpdatePreferencesResponse,
  UploadAdditionalCvsResponse,
  User,
} from '@career-rafiq/contracts';
import {
  InMemoryAuthSessionService,
  buildPositioningSummary,
  buildSmartDefaultPreferenceProfile,
  createId,
  createTrackerItem,
  evaluateJob,
  extractEmails,
  extractPagePayload,
  getAccessLevel,
  getTemporaryAccessExpiry,
  inferCareerTrack,
  inferCoreStack,
  inferExcludedDomains,
  inferPrimaryRole,
  inferSecondaryRoles,
  inferSeniority,
  isTemporaryAccessExpired,
  isSourceSupported,
  normalizePreferenceProfile,
  normalizeText,
  nowIso,
  patchTrackerDuplicateResolution,
  patchTrackerStatus,
  patchTrackerRecommendationDecision,
  patchTrackerVerdictDecision,
  requiresEmailCollection,
  requiresVerificationForReturnAccess,
  unique,
  updateTrackerFromEvaluation,
  validateExtraction,
} from '@career-rafiq/core';
import { CareerRafiqRepository, type EmailOutboxRecord, type JobExtractionRecord, type SessionRecord, type StoredCvFile, type StoredCvVersion, type StoredMagicLinkToken } from '@career-rafiq/db';
import {
  getAllowedCorsOrigins,
  getAiFeatureFlags,
  getCaptureRateLimitMax,
  getCaptureRateLimitWindowMs,
  getCookieSameSiteMode,
  getEmailFromAddress,
  getEmailProviderMode,
  getExtensionOrigin,
  getEyeRetentionDays,
  getMagicLinkThrottleMs,
  getMaxCvUploadBytes,
  getMaxCvUploadCount,
  getUploadRateLimitMax,
  getUploadRateLimitWindowMs,
  getUploadsDir,
  getWebOrigin,
  isEyeModeEnabled,
  isOperatorEmail,
  isDevAutoVerifyMagicLinkEnabled,
  allowInsecureDevCookie,
  shouldUseSecureCookies,
} from './config.js';
import { AiOrchestrator, buildSetupArtifactSummaries, collectArtifactReferences, mergeExtractionCandidates, shouldRunAiExtractionFallback, type CvFileClassification, type CvProfileSuggestion, type PreferenceSuggestion } from './ai.js';
import { createEmailDeliveryService, type EmailDeliveryService } from './email.js';
import { redactDiagnosticPayload, summarizeObjectDiff } from './eye-diagnostics.js';
import { CLIENT_SURFACE_HEADER, EYE_SESSION_HEADER, REQUEST_ID_HEADER, getRequestDiagnosticContext } from './request-context.js';
import { extractTextFromUpload, persistUploadBinary, validateCvUploads, type ExtractedUploadText, type ParsedMultipartUpload } from './uploads.js';

export interface ApiServiceOptions {
  repository?: CareerRafiqRepository;
  clock?: () => Date;
  dailyEvaluationLimit?: number;
  magicLinkExpiryMinutes?: number;
  aiOrchestrator?: AiOrchestrator;
  emailDeliveryService?: EmailDeliveryService;
}

export interface SessionContext {
  session: SessionRecord;
  user: User;
}

interface AnalyzedCvUpload {
  upload: ParsedMultipartUpload;
  uploadToken: string;
  classification: CvDocumentClassification | null;
  extraction: ExtractedUploadText | null;
  status: CvUploadAnalysisResult['status'];
  warning: string | null;
  contentHash: string | null;
  candidateMatches: CvMatchCandidate[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('hex');
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.trim().toLowerCase();
}

function normalizeDuplicateText(value: string | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildProbableDuplicateKey(job: Job): string | null {
  const parts = [
    normalizeDuplicateText(job.normalizedJobObject.title),
    normalizeDuplicateText(job.normalizedJobObject.company),
    normalizeDuplicateText(job.normalizedJobObject.location),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('|') : null;
}

function sourceDomainFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function toExtractionConfidenceBand(value: number): string {
  if (value >= 0.85) {
    return 'high';
  }
  if (value >= 0.6) {
    return 'medium';
  }
  if (value > 0) {
    return 'low';
  }
  return 'none';
}

function filterProbableDuplicateJobIds(candidateIds: string[], trackerItem: TrackerItem | null): string[] {
  const uniqueCandidateIds = unique(candidateIds);
  if (!trackerItem) {
    return uniqueCandidateIds;
  }
  const dismissed = trackerItem.duplicateResolution?.dismissedJobIds ?? [];
  const confirmedDuplicateJobId =
    trackerItem.duplicateResolution?.decision === 'duplicate_confirmed'
      ? trackerItem.duplicateResolution.duplicateJobId
      : null;

  return uniqueCandidateIds.filter((jobId) => !dismissed.includes(jobId) && jobId !== confirmedDuplicateJobId);
}

const trackerStatusOrder: TrackerStatus[] = [
  'saved',
  'considering',
  'applied',
  'interviewing',
  'rejected',
  'offer',
  'archived_not_pursuing',
];

const opsKeyAnalyticsEvents: AnalyticsEventName[] = [
  'setup_review_opened',
  'magic_link_sent',
  'email_verified',
  'job_capture_started',
  'evaluation_completed',
  'verdict_shown',
  'tracker_opened',
];

const analyticsEventNameSet = new Set<string>(AnalyticsEventNames);

function mergeConsensusSummaries(...values: Array<AiConsensusSummary | null | undefined>): AiConsensusSummary | null {
  const summaries = values.filter((value): value is AiConsensusSummary => Boolean(value));
  if (summaries.length === 0) {
    return null;
  }
  if (summaries.length === 1) {
    return summaries[0]!;
  }
  return {
    enabled: summaries.some((summary) => summary.enabled),
    strategy: summaries.some((summary) => summary.strategy === 'multi_run_consensus') ? 'multi_run_consensus' : 'single_run',
    runs: summaries.reduce((max, summary) => Math.max(max, summary.runs), 1),
    agreement: summaries.some((summary) => summary.agreement === 'low')
      ? 'low'
      : summaries.some((summary) => summary.agreement === 'mixed')
        ? 'mixed'
        : summaries.some((summary) => summary.agreement === 'strong')
          ? 'strong'
          : 'single_run',
    triggeredBy: unique(summaries.flatMap((summary) => summary.triggeredBy)),
  };
}

function withMergedValidationMetadata(
  validation: ReturnType<typeof validateExtraction>,
  metadata: Partial<Pick<ReturnType<typeof validateExtraction>, 'fieldEvidence' | 'mergedFieldProvenance' | 'coherenceAssessment'>>,
): ReturnType<typeof validateExtraction> {
  return {
    ...validation,
    fieldEvidence: [
      ...(validation.fieldEvidence ?? []),
      ...(metadata.fieldEvidence ?? []),
    ],
    mergedFieldProvenance: {
      ...(validation.mergedFieldProvenance ?? {}),
      ...(metadata.mergedFieldProvenance ?? {}),
    },
    coherenceAssessment: metadata.coherenceAssessment ?? validation.coherenceAssessment ?? null,
  };
}

function choosePreferredEmail(rawTexts: string[]): { preferredEmail: string | null; detectedEmails: string[] } {
  const counts = new Map<string, number>();
  const firstSeenOrder: string[] = [];

  for (const text of rawTexts) {
    for (const email of extractEmails(text)) {
      const normalized = normalizeEmail(email);
      if (!counts.has(normalized)) {
        firstSeenOrder.push(normalized);
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    return { preferredEmail: null, detectedEmails: [] };
  }

  const preferredEmail =
    [...counts.entries()]
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return firstSeenOrder.indexOf(left[0]) - firstSeenOrder.indexOf(right[0]);
      })[0]?.[0] ?? null;

  return {
    preferredEmail,
    detectedEmails: firstSeenOrder,
  };
}

function normalizeCvTitle(value: string | null | undefined): string {
  return normalizeText(value ?? '')
    .replace(/\b(resume|curriculum vitae|cv)\b/g, ' ')
    .replace(/\b(pdf|docx|txt)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeCvContent(value: string | null | undefined): string[] {
  return unique(
    normalizeText(value ?? '')
      .split(' ')
      .filter((token) => token.length >= 3),
  );
}

function calculateTokenSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = new Set(tokenizeCvContent(left));
  const rightTokens = new Set(tokenizeCvContent(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }
  const denominator = Math.max(leftTokens.size, rightTokens.size);
  return denominator === 0 ? 0 : shared / denominator;
}

function calculateTitleSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const normalizedLeft = normalizeCvTitle(left);
  const normalizedRight = normalizeCvTitle(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.9;
  }
  return calculateTokenSimilarity(normalizedLeft, normalizedRight);
}

function hashCvContent(rawText: string): string {
  return sha256(normalizeText(rawText));
}

function toPublicCv(cv: StoredCvFile): CV {
  const { mimeType: _mimeType, storedFilePath: _storedFilePath, ...publicCv } = cv;
  return publicCv;
}

function toPublicCvVersion(version: StoredCvVersion): CVVersion {
  const { mimeType: _mimeType, storedFilePath: _storedFilePath, ...publicVersion } = version;
  return publicVersion;
}

function buildStoredCvVersion(args: {
  versionId: string;
  cvId: string;
  userId: string;
  upload: ParsedMultipartUpload;
  storedFilePath: string;
  rawText: string;
  classification: CvDocumentClassification | null;
  uploadedAt: string;
  supersededAt?: string | null;
}): StoredCvVersion {
  return {
    id: args.versionId,
    cvId: args.cvId,
    userId: args.userId,
    fileName: args.upload.fileName,
    originalFileName: args.upload.fileName,
    rawText: args.rawText,
    contentHash: args.rawText.trim() ? hashCvContent(args.rawText) : null,
    classification: args.classification,
    uploadedAt: args.uploadedAt,
    supersededAt: args.supersededAt ?? null,
    mimeType: args.upload.mimeType,
    storedFilePath: args.storedFilePath,
  };
}

function buildStoredCvFile(args: {
  cvId: string;
  userId: string;
  upload: ParsedMultipartUpload;
  version: StoredCvVersion;
  extractedEmail: string | null;
  uploadedAt: string;
  existingUploadedAt?: string;
  extractionWarning?: string | null;
}): StoredCvFile {
  const processingStatus =
    args.version.rawText?.length
      ? 'profile_generated'
      : args.extractionWarning
        ? 'failed'
        : 'review_required';

  return {
    id: args.cvId,
    userId: args.userId,
    fileName: args.upload.fileName,
    originalFileName: args.upload.fileName,
    rawText: args.version.rawText,
    extractedEmail: args.extractedEmail,
    processingStatus,
    contentHash: args.version.contentHash,
    latestVersionId: args.version.id,
    latestClassification: args.version.classification,
    uploadedAt: args.existingUploadedAt ?? args.uploadedAt,
    updatedAt: args.uploadedAt,
    mimeType: args.upload.mimeType,
    storedFilePath: args.version.storedFilePath,
  };
}

function getEffectiveCvProfileValue<T>(existing: CVProfile, nextInferred: Record<string, unknown>, key: string, fallback: T): T {
  if (Object.prototype.hasOwnProperty.call(existing.overrideValues, key)) {
    return existing.overrideValues[key] as T;
  }
  if (Object.prototype.hasOwnProperty.call(existing.confirmedValues, key)) {
    return existing.confirmedValues[key] as T;
  }
  if (Object.prototype.hasOwnProperty.call(nextInferred, key)) {
    return nextInferred[key] as T;
  }
  return fallback;
}

function applyExistingCvProfileDecisions(existing: CVProfile, baseline: CVProfile): CVProfile {
  const nextInferredValues = {
    ...baseline.inferredValues,
    cvName: baseline.cvName,
    primaryRole: baseline.primaryRole,
    secondaryRoles: baseline.secondaryRoles,
    seniority: baseline.seniority,
    careerTrack: baseline.careerTrack,
    coreStack: baseline.coreStack,
    positioningSummary: baseline.positioningSummary,
    excludedDomains: baseline.excludedDomains,
  };

  return {
    ...baseline,
    id: existing.id,
    createdAt: existing.createdAt,
    confirmedValues: existing.confirmedValues,
    overrideValues: existing.overrideValues,
    inferredValues: nextInferredValues,
    cvName: getEffectiveCvProfileValue(existing, nextInferredValues, 'cvName', baseline.cvName),
    primaryRole: getEffectiveCvProfileValue(existing, nextInferredValues, 'primaryRole', baseline.primaryRole),
    secondaryRoles: getEffectiveCvProfileValue(existing, nextInferredValues, 'secondaryRoles', baseline.secondaryRoles),
    seniority: getEffectiveCvProfileValue(existing, nextInferredValues, 'seniority', baseline.seniority),
    careerTrack: getEffectiveCvProfileValue(existing, nextInferredValues, 'careerTrack', baseline.careerTrack),
    coreStack: getEffectiveCvProfileValue(existing, nextInferredValues, 'coreStack', baseline.coreStack),
    positioningSummary: getEffectiveCvProfileValue(existing, nextInferredValues, 'positioningSummary', baseline.positioningSummary),
    excludedDomains: getEffectiveCvProfileValue(existing, nextInferredValues, 'excludedDomains', baseline.excludedDomains),
  };
}

function buildCvMatchCandidates(
  upload: { fileName: string; rawText: string; contentHash: string | null },
  existingCvs: StoredCvFile[],
  existingProfiles: CVProfile[],
): CvMatchCandidate[] {
  const candidates = existingCvs
    .map((cv) => {
      const profile = existingProfiles.find((candidate) => candidate.cvId === cv.id) ?? null;
      const exactTitleMatch =
        normalizeCvTitle(upload.fileName).length > 0 &&
        [
          cv.originalFileName,
          cv.fileName,
          profile?.cvName ?? null,
        ].some((value) => normalizeCvTitle(value) === normalizeCvTitle(upload.fileName));
      const titleSimilarity = Math.max(
        calculateTitleSimilarity(upload.fileName, cv.originalFileName),
        calculateTitleSimilarity(upload.fileName, cv.fileName),
        calculateTitleSimilarity(upload.fileName, profile?.cvName ?? null),
      );
      const exactContentMatch = Boolean(upload.contentHash && cv.contentHash && upload.contentHash === cv.contentHash);
      const contentSimilarity = calculateTokenSimilarity(upload.rawText, cv.rawText);

      let matchType: CvMatchCandidate['matchType'] | null = null;
      let score = 0;
      const reasons: string[] = [];

      if (exactContentMatch) {
        matchType = 'exact_content';
        score = 1;
        reasons.push('Normalized CV content matches an existing CV exactly.');
      } else if (exactTitleMatch) {
        matchType = 'exact_title';
        score = 0.96;
        reasons.push('Uploaded file title matches an existing CV title.');
      } else if (contentSimilarity >= 0.85) {
        matchType = 'similar_content';
        score = contentSimilarity;
        reasons.push(`Content similarity is ${(contentSimilarity * 100).toFixed(0)}%.`);
      } else if (titleSimilarity >= 0.85) {
        matchType = 'fuzzy_title';
        score = titleSimilarity;
        reasons.push(`Title similarity is ${(titleSimilarity * 100).toFixed(0)}%.`);
      }

      if (!matchType) {
        return null;
      }

      return {
        candidateCvId: cv.id,
        candidateCvName: profile?.cvName ?? cv.fileName,
        matchType,
        score,
        reasons,
      } satisfies CvMatchCandidate;
    })
    .filter((candidate): candidate is CvMatchCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  return candidates;
}

function createCvProfile(userId: string, cv: StoredCvFile, clock: () => Date) {
  const text = `${cv.fileName} ${cv.rawText ?? ''}`;
  const primaryRole = inferPrimaryRole(text);
  const seniority = inferSeniority(text);
  const coreStack = inferCoreStack(text);
  const careerTrack = inferCareerTrack(text);
  return {
    id: createId('cvp'),
    userId,
    cvId: cv.id,
    cvName: cv.fileName,
    primaryRole,
    secondaryRoles: inferSecondaryRoles(text, primaryRole),
    seniority,
    careerTrack,
    coreStack,
    positioningSummary: buildPositioningSummary(primaryRole, coreStack, seniority),
    excludedDomains: inferExcludedDomains(text),
    inferredValues: { primaryRole, seniority, careerTrack, coreStack },
    confirmedValues: {},
    overrideValues: {},
    createdAt: nowIso(clock),
    updatedAt: nowIso(clock),
  } satisfies SetupBootstrapResponse['cvProfiles'][number];
}

function buildSetupFlags(
  user: User,
  detectedEmails: string[],
  selectedEmailCandidate?: string | null,
): Pick<
  SetupBootstrapResponse,
  'selectedEmailCandidate' | 'emailConflictDetected' | 'emailCollectionRequired' | 'returnAccessRequiresVerification'
> {
  const normalizedDetectedEmails = unique(detectedEmails.map(normalizeEmail));
  return {
    selectedEmailCandidate: selectedEmailCandidate ?? user.email ?? normalizedDetectedEmails[0] ?? null,
    emailConflictDetected: normalizedDetectedEmails.length > 1,
    emailCollectionRequired: requiresEmailCollection(user),
    returnAccessRequiresVerification: requiresVerificationForReturnAccess(user),
  };
}

function normalizeList(values: string[]): string[] {
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

function applyCvSuggestion(profile: CVProfile, suggestion: CvProfileSuggestion | null, artifactReference: AiArtifactReference | null): CVProfile {
  if (!suggestion) {
    return profile;
  }

  return {
    ...profile,
    inferredValues: {
    ...profile.inferredValues,
    ...suggestion,
    aiArtifactIds: unique([...(Array.isArray(profile.inferredValues['aiArtifactIds']) ? profile.inferredValues['aiArtifactIds'] as string[] : []), ...(artifactReference ? [artifactReference.id] : [])]),
    },
  };
}

function applyPreferenceSuggestion(
  profile: PreferenceProfile,
  suggestion: PreferenceSuggestion | null,
  artifactReference: AiArtifactReference | null,
): PreferenceProfile {
  if (!suggestion) {
    return profile;
  }

  return {
    ...profile,
    inferredValues: {
      ...profile.inferredValues,
      ...suggestion,
      aiArtifactIds: unique([...(Array.isArray(profile.inferredValues['aiArtifactIds']) ? profile.inferredValues['aiArtifactIds'] as string[] : []), ...(artifactReference ? [artifactReference.id] : [])]),
    },
  };
}

function listEquals(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeList(left);
  const normalizedRight = normalizeList(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

const EXTRACTION_REVIEW_FIELDS = [
  'title',
  'company',
  'location',
  'workSetup',
  'employmentType',
  'description',
  'recruiterOrPosterSignal',
  'companySector',
  'companyType',
  'keywords',
] as const;

function extractionFieldValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return listEquals(left.map(String), right.map(String));
  }
  return left === right;
}

function formatExtractionFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join(', ') : 'none';
  }
  if (value === null || typeof value === 'undefined' || value === '') {
    return 'none';
  }
  return String(value);
}

function buildManualExtractionMetadata(
  previousCandidate: ExtractPageResponse['extraction']['extractionCandidate'],
  nextCandidate: ExtractPageResponse['extraction']['extractionCandidate'],
): {
  changedFields: string[];
  fieldEvidence: NonNullable<ReturnType<typeof validateExtraction>['fieldEvidence']>;
  mergedFieldProvenance: NonNullable<ReturnType<typeof validateExtraction>['mergedFieldProvenance']>;
} {
  const changedFields: string[] = [];
  const fieldEvidence: NonNullable<ReturnType<typeof validateExtraction>['fieldEvidence']> = [];
  const mergedFieldProvenance: NonNullable<ReturnType<typeof validateExtraction>['mergedFieldProvenance']> = {};

  for (const field of EXTRACTION_REVIEW_FIELDS) {
    const previousValue = previousCandidate[field];
    const nextValue = nextCandidate[field];
    if (extractionFieldValuesEqual(previousValue, nextValue)) {
      continue;
    }
    changedFields.push(field);
    mergedFieldProvenance[field] = 'user_corrected';
    fieldEvidence.push({
      field,
      confidence: 1,
      provenance: 'user_corrected',
      evidence: [formatExtractionFieldValue(nextValue)],
      reasons: [`Manual review updated ${field} from "${formatExtractionFieldValue(previousValue)}" to "${formatExtractionFieldValue(nextValue)}".`],
    });
  }

  return {
    changedFields,
    fieldEvidence,
    mergedFieldProvenance,
  };
}

function buildCvProfileValueMaps(existing: CVProfile, input: UpdateCvProfileRequest): Pick<CVProfile, 'confirmedValues' | 'overrideValues'> {
  const nextConfirmedValues: CVProfile['confirmedValues'] = {
    cvName: input.cvName,
    primaryRole: input.primaryRole,
    secondaryRoles: unique(input.secondaryRoles),
    seniority: input.seniority,
    careerTrack: input.careerTrack,
    coreStack: unique(input.coreStack),
    positioningSummary: input.positioningSummary,
    excludedDomains: unique(input.excludedDomains),
  };

  const inferred = existing.inferredValues;
  const nextOverrideValues: CVProfile['overrideValues'] = {};
  if ((inferred['primaryRole'] as string | null | undefined) !== input.primaryRole) nextOverrideValues['primaryRole'] = input.primaryRole;
  if ((inferred['seniority'] as CVProfile['seniority'] | undefined) !== input.seniority) nextOverrideValues['seniority'] = input.seniority;
  if ((inferred['careerTrack'] as string | null | undefined) !== input.careerTrack) nextOverrideValues['careerTrack'] = input.careerTrack;
  if (!listEquals((inferred['coreStack'] as string[] | undefined) ?? [], input.coreStack)) nextOverrideValues['coreStack'] = unique(input.coreStack);
  if (!listEquals((inferred['secondaryRoles'] as string[] | undefined) ?? [], input.secondaryRoles)) nextOverrideValues['secondaryRoles'] = unique(input.secondaryRoles);
  if (!listEquals((inferred['excludedDomains'] as string[] | undefined) ?? [], input.excludedDomains)) nextOverrideValues['excludedDomains'] = unique(input.excludedDomains);
  if ((inferred['positioningSummary'] as string | undefined) !== input.positioningSummary) nextOverrideValues['positioningSummary'] = input.positioningSummary;
  if (existing.cvName !== input.cvName) nextOverrideValues['cvName'] = input.cvName;

  return {
    confirmedValues: nextConfirmedValues,
    overrideValues: nextOverrideValues,
  };
}

function buildPreferenceValueMaps(existing: PreferenceProfile | null, input: PreferenceProfile): Pick<PreferenceProfile, 'confirmedValues' | 'overrideValues'> {
  const nextConfirmedValues: PreferenceProfile['confirmedValues'] = {
    strictLocationHandling: input.strictLocationHandling,
    workSetupPreferences: input.workSetupPreferences,
    employmentTypePreferences: input.employmentTypePreferences,
    preferredSeniorityRange: input.preferredSeniorityRange,
    scopePreferences: [...input.scopePreferences],
    preferGreenfield: input.preferGreenfield,
    preferHighOwnership: input.preferHighOwnership,
    allowedOnSiteCountries: [...input.allowedOnSiteCountries],
    allowedOnSiteCities: [...input.allowedOnSiteCities],
    preferredLocations: [...input.preferredLocations],
    avoidedLocations: [...input.avoidedLocations],
    preferredRoleTracks: [...input.preferredRoleTracks],
    avoidedRoleTracks: [...input.avoidedRoleTracks],
    preferredJobTitles: [...input.preferredJobTitles],
    avoidedJobTitles: [...input.avoidedJobTitles],
    preferredSectors: [...input.preferredSectors],
    avoidedSectors: [...input.avoidedSectors],
    preferredCompanyTypes: [...input.preferredCompanyTypes],
    avoidedCompanyTypes: [...input.avoidedCompanyTypes],
    preferredKeywords: [...input.preferredKeywords],
    requiredKeywords: [...input.requiredKeywords],
    avoidedKeywords: [...input.avoidedKeywords],
  };

  const inferred = existing?.inferredValues ?? {};
  const nextOverrideValues: PreferenceProfile['overrideValues'] = {};
  const listFields = [
    'scopePreferences',
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
  ] as const;

  for (const field of listFields) {
    if (!listEquals((inferred[field] as string[] | undefined) ?? [], input[field])) {
      nextOverrideValues[field] = [...input[field]];
    }
  }
  if ((inferred['strictLocationHandling'] as boolean | undefined) !== input.strictLocationHandling) {
    nextOverrideValues['strictLocationHandling'] = input.strictLocationHandling;
  }
  if (JSON.stringify(inferred['workSetupPreferences'] ?? {}) !== JSON.stringify(input.workSetupPreferences)) {
    nextOverrideValues['workSetupPreferences'] = { ...input.workSetupPreferences };
  }
  if (JSON.stringify(inferred['employmentTypePreferences'] ?? {}) !== JSON.stringify(input.employmentTypePreferences)) {
    nextOverrideValues['employmentTypePreferences'] = { ...input.employmentTypePreferences };
  }
  if (JSON.stringify(inferred['preferredSeniorityRange'] ?? {}) !== JSON.stringify(input.preferredSeniorityRange)) {
    nextOverrideValues['preferredSeniorityRange'] = { ...input.preferredSeniorityRange };
  }
  if ((inferred['preferGreenfield'] as boolean | undefined) !== input.preferGreenfield) {
    nextOverrideValues['preferGreenfield'] = input.preferGreenfield;
  }
  if ((inferred['preferHighOwnership'] as boolean | undefined) !== input.preferHighOwnership) {
    nextOverrideValues['preferHighOwnership'] = input.preferHighOwnership;
  }

  return {
    confirmedValues: nextConfirmedValues,
    overrideValues: nextOverrideValues,
  };
}

function toPublicSetupResponse(
  user: User,
  cvs: StoredCvFile[],
  cvProfiles: SetupBootstrapResponse['cvProfiles'],
  preferenceProfile: SetupBootstrapResponse['preferenceProfile'],
  detectedEmails: string[],
  selectedEmailCandidate: string | null,
  setupWarnings: string[],
  setupAiArtifacts: AiArtifactReference[],
  preferenceAudits: SetupBootstrapResponse['preferenceAudits'],
): SetupBootstrapResponse {
  return {
    user,
    cvs: cvs.map(toPublicCv),
    cvProfiles,
    preferenceProfile,
    magicLinkToken: null,
    minimumUsableDataReady: cvProfiles.length > 0,
    detectedEmails,
    ...buildSetupFlags(user, detectedEmails, selectedEmailCandidate),
    setupWarnings,
    setupAiArtifacts,
    preferenceAudits,
    uploadResults: [],
  };
}

export class CareerRafiqApiService {
  private readonly repository: CareerRafiqRepository;

  private readonly clock: () => Date;

  private readonly dailyEvaluationLimit: number;

  private readonly magicLinkExpiryMinutes: number;

  private readonly magicLinkThrottleMs: number;

  private readonly ai: AiOrchestrator;

  private readonly emailDelivery: EmailDeliveryService;

  private readonly lastMagicLinkRequestAtByEmail = new Map<string, number>();

  constructor(options: ApiServiceOptions = {}) {
    this.repository = options.repository ?? CareerRafiqRepository.open();
    this.clock = options.clock ?? (() => new Date());
    this.dailyEvaluationLimit = options.dailyEvaluationLimit ?? 25;
    this.magicLinkExpiryMinutes = options.magicLinkExpiryMinutes ?? 30;
    this.magicLinkThrottleMs = getMagicLinkThrottleMs();
    this.ai = options.aiOrchestrator ?? new AiOrchestrator(this.repository, this.clock, getAiFeatureFlags());
    this.emailDelivery = options.emailDeliveryService ?? createEmailDeliveryService();
    this.pruneEyeDiagnostics();
  }

  close(): void {
    this.repository.close();
  }

  private now(): string {
    return nowIso(this.clock);
  }

  private buildSessionExpiry(user: User): string {
    if (user.accountStatus === 'verified') {
      return new Date(this.clock().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }
    return getTemporaryAccessExpiry(user, this.clock(), 24);
  }

  private recordEvent(name: AnalyticsEventName, userId: string | null, properties: Record<string, unknown>): void {
    this.repository.recordAnalyticsEvent({
      id: createId('evt'),
      userId,
      name,
      timestamp: this.now(),
      properties,
    });
  }

  private pruneEyeDiagnostics(): void {
    if (!isEyeModeEnabled()) {
      return;
    }
    const cutoff = new Date(this.clock().getTime() - getEyeRetentionDays() * 24 * 60 * 60 * 1000).toISOString();
    this.repository.pruneDiagnosticEventsOlderThan(cutoff);
    this.repository.pruneEyeSessionsOlderThan(cutoff);
  }

  private getOperatorUser(userId: string): User {
    const user = this.repository.getUserById(userId);
    if (!user || !isEyeModeEnabled() || !isOperatorEmail(user.email)) {
      throw new Error('Operator access is required for Eye diagnostics.');
    }
    return user;
  }

  isOperatorUser(userId: string | null | undefined): boolean {
    if (!userId || !isEyeModeEnabled()) {
      return false;
    }
    const user = this.repository.getUserById(userId);
    return Boolean(user && isOperatorEmail(user.email));
  }

  private getCurrentEyeSessionId(): string | null {
    return getRequestDiagnosticContext()?.eyeSessionId ?? null;
  }

  private hasEyeSession(): boolean {
    return Boolean(this.getCurrentEyeSessionId());
  }

  recordDiagnosticEvent(input: {
    area: DiagnosticArea;
    stage: string;
    code: string;
    severity: 'info' | 'warning' | 'error';
    summary: string;
    payload?: Record<string, unknown>;
    userId?: string | null;
    jobId?: string | null;
    trackerItemId?: string | null;
    requestId?: string | null;
    eyeSessionId?: string | null;
  }): void {
    const requestContext = getRequestDiagnosticContext();
    const eyeSessionId = input.eyeSessionId ?? requestContext?.eyeSessionId ?? null;
    if (!eyeSessionId && input.severity === 'info') {
      return;
    }
    this.repository.saveDiagnosticEvent({
      id: createId('diag'),
      eyeSessionId,
      requestId: input.requestId ?? requestContext?.requestId ?? null,
      userId: input.userId ?? requestContext?.userId ?? null,
      jobId: input.jobId ?? null,
      trackerItemId: input.trackerItemId ?? null,
      area: input.area,
      stage: input.stage,
      code: input.code,
      severity: input.severity,
      summary: input.summary,
      payload: redactDiagnosticPayload(input.payload ?? {}) as Record<string, unknown>,
      createdAt: this.now(),
    });
  }

  getEyeCurrent(userId: string): EyeCurrentResponse {
    this.getOperatorUser(userId);
    return {
      enabled: isEyeModeEnabled(),
      operatorAccess: true,
      session: this.repository.getActiveEyeSessionByOperatorUserId(userId),
    };
  }

  startEyeSession(userId: string, input: StartEyeSessionRequest): EyeSessionResponse {
    this.getOperatorUser(userId);
    const now = this.now();
    this.repository.runInTransaction(() => {
      this.repository.stopActiveEyeSessionsForOperator(userId, now);
    });
    const session = this.repository.saveEyeSession({
      id: createId('eye'),
      operatorUserId: userId,
      label: input.label?.trim() || null,
      status: 'active',
      startedAt: now,
      endedAt: null,
      lastEventAt: null,
      webAppVersion: input.webAppVersion?.trim() || null,
      extensionVersion: input.extensionVersion?.trim() || null,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    this.recordDiagnosticEvent({
      area: 'ops',
      stage: 'session',
      code: 'eye_session_started',
      severity: 'info',
      summary: 'Eye session started.',
      userId,
      eyeSessionId: session.id,
      payload: {
        label: session.label,
        webAppVersion: session.webAppVersion,
        extensionVersion: session.extensionVersion,
      },
    });
    return { session };
  }

  stopEyeSession(userId: string, sessionId: string): EyeSessionResponse {
    this.getOperatorUser(userId);
    const existing = this.repository.getEyeSessionById(sessionId);
    if (!existing || existing.operatorUserId !== userId) {
      throw new Error(`Eye session ${sessionId} was not found.`);
    }
    const now = this.now();
    const session = this.repository.saveEyeSession({
      ...existing,
      status: 'stopped',
      endedAt: now,
      updatedAt: now,
    });
    this.recordDiagnosticEvent({
      area: 'ops',
      stage: 'session',
      code: 'eye_session_stopped',
      severity: 'info',
      summary: 'Eye session stopped.',
      userId,
      eyeSessionId: session.id,
      payload: {
        label: session.label,
      },
    });
    return { session };
  }

  listEyeSessions(userId: string): EyeSessionsResponse {
    this.getOperatorUser(userId);
    return {
      sessions: this.repository.listEyeSessionsByOperatorUserId(userId),
    };
  }

  listDiagnosticEvents(userId: string, input: ListDiagnosticEventsRequest): DiagnosticEventsResponse {
    this.getOperatorUser(userId);
    if (input.eyeSessionId) {
      const eyeSession = this.repository.getEyeSessionById(input.eyeSessionId);
      if (!eyeSession || eyeSession.operatorUserId !== userId) {
        throw new Error(`Eye session ${input.eyeSessionId} was not found.`);
      }
    }
    const sinceIso = typeof input.sinceMinutes === 'number' && input.sinceMinutes > 0
      ? new Date(this.clock().getTime() - input.sinceMinutes * 60 * 1000).toISOString()
      : null;
    return {
      events: this.repository.listDiagnosticEvents({
        eyeSessionId: input.eyeSessionId ?? null,
        requestId: input.requestId ?? null,
        ...(input.eyeSessionId ? {} : { userId }),
        jobId: input.jobId ?? null,
        area: input.area ?? null,
        severity: input.severity ?? null,
        sinceIso,
        limit: input.limit ?? 200,
      }),
    };
  }

  getDiagnosticEvent(userId: string, eventId: string): DiagnosticEventResponse {
    this.getOperatorUser(userId);
    const event = this.repository.getDiagnosticEventById(eventId);
    if (!event) {
      return { event: null };
    }
    if (event.eyeSessionId) {
      const session = this.repository.getEyeSessionById(event.eyeSessionId);
      if (!session || session.operatorUserId !== userId) {
        throw new Error(`Diagnostic event ${eventId} was not found.`);
      }
    } else if (event.userId !== userId) {
      throw new Error(`Diagnostic event ${eventId} was not found.`);
    }
    return { event };
  }

  recordClientDiagnosticEvent(userId: string, input: RecordClientDiagnosticEventRequest): RecordClientDiagnosticEventResponse {
    this.getOperatorUser(userId);
    const eyeSessionId = input.eyeSessionId ?? this.getCurrentEyeSessionId();
    if (eyeSessionId) {
      const session = this.repository.getEyeSessionById(eyeSessionId);
      if (!session || session.operatorUserId !== userId || session.status !== 'active') {
        throw new Error(`Eye session ${eyeSessionId} was not found.`);
      }
    }
    this.recordDiagnosticEvent({
      area: input.area,
      stage: input.stage,
      code: input.code,
      severity: input.severity,
      summary: input.summary,
      userId,
      jobId: input.jobId ?? null,
      trackerItemId: input.trackerItemId ?? null,
      requestId: input.requestId ?? null,
      eyeSessionId,
      payload: {
        clientSurface: input.clientSurface ?? 'web',
        ...(input.payload ?? {}),
      },
    });
    const latestEvent = this.repository.listDiagnosticEvents({
      eyeSessionId,
      requestId: input.requestId ?? null,
      userId,
      area: input.area,
      limit: 1,
    })[0] ?? null;
    return {
      ok: true,
      event: latestEvent,
    };
  }

  getRuntimeDetail(userId: string): RuntimeDetailResponse {
    this.getOperatorUser(userId);
    return {
      eye: {
        enabled: isEyeModeEnabled(),
        retentionDays: getEyeRetentionDays(),
      },
      origins: {
        allowed: getAllowedCorsOrigins(),
        web: getWebOrigin(),
        extension: getExtensionOrigin(),
      },
      cookies: {
        secure: shouldUseSecureCookies(),
        sameSite: getCookieSameSiteMode(),
        insecureDevCookie: allowInsecureDevCookie(),
      },
      rateLimits: {
        upload: {
          max: getUploadRateLimitMax(),
          windowSeconds: Math.floor(getUploadRateLimitWindowMs() / 1000),
        },
        capture: {
          max: getCaptureRateLimitMax(),
          windowSeconds: Math.floor(getCaptureRateLimitWindowMs() / 1000),
        },
        magicLinkThrottleSeconds: Math.floor(this.magicLinkThrottleMs / 1000),
      },
      email: {
        providerMode: getEmailProviderMode(),
        fromAddress: getEmailFromAddress(),
      },
      correlation: {
        requestIdHeader: REQUEST_ID_HEADER,
        eyeSessionHeader: EYE_SESSION_HEADER,
        clientSurfaceHeader: CLIENT_SURFACE_HEADER,
      },
      timestamp: this.now(),
    };
  }

  private createSession(user: User, accessLevel = getAccessLevel(user)): { rawToken: string; session: SessionRecord } {
    const rawToken = randomToken();
    const now = this.now();
    const record: SessionRecord = {
      id: createId('ses'),
      userId: user.id,
      tokenHash: sha256(rawToken),
      accessLevel,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      expiresAt: this.buildSessionExpiry(user),
    };
    this.repository.createSession(record);
    return { rawToken, session: record };
  }

  private async createMagicLink(
    user: User,
    email: string,
  ): Promise<{ rawToken: string; record: StoredMagicLinkToken; outbox: EmailOutboxRecord; deliveryFailed: boolean }> {
    const rawToken = randomToken();
    const tokenHash = sha256(rawToken);
    const createdAt = this.now();
    const expiresAt = new Date(this.clock().getTime() + this.magicLinkExpiryMinutes * 60 * 1000).toISOString();
    const record: StoredMagicLinkToken = {
      id: createId('mlt'),
      userId: user.id,
      email,
      tokenHash,
      expiresAt,
      consumedAt: null,
      createdAt,
    };
    const outbox: EmailOutboxRecord = {
      id: createId('mail'),
      userId: user.id,
      email,
      kind: 'magic_link',
      subject: 'CareerRafiq sign-in link',
      body: `Use this link to sign in: /auth/consume?token=${rawToken}&email=${encodeURIComponent(email)}`,
      deliveryStatus: 'queued',
      deliveryProvider: this.emailDelivery.isConfigured() ? 'smtp' : 'dev_outbox',
      sentAt: null,
      lastAttemptAt: null,
      errorMessage: null,
      externalMessageId: null,
      createdAt,
    };
    this.lastMagicLinkRequestAtByEmail.set(email, this.clock().getTime());
    this.repository.saveMagicLinkToken(record);
    this.repository.pushEmailOutbox(outbox);
    const delivery = await this.emailDelivery.send({
      to: email,
      subject: outbox.subject,
      text: outbox.body,
    });
    const updatedOutbox: EmailOutboxRecord = {
      ...outbox,
      deliveryStatus:
        delivery.status === 'sent'
          ? 'sent'
          : delivery.provider === 'dev_outbox'
            ? 'dev_outbox'
            : 'failed',
      deliveryProvider: delivery.provider,
      sentAt: delivery.sentAt,
      lastAttemptAt: delivery.lastAttemptAt,
      errorMessage: delivery.errorMessage,
      externalMessageId: delivery.messageId,
    };
    this.repository.updateEmailOutbox(updatedOutbox);
    return {
      rawToken,
      record,
      outbox: updatedOutbox,
      deliveryFailed: delivery.status === 'failed',
    };
  }

  private enforceMagicLinkThrottle(email: string): void {
    if (this.magicLinkThrottleMs <= 0) {
      return;
    }
    const now = this.clock().getTime();
    const previous = this.lastMagicLinkRequestAtByEmail.get(email) ?? 0;
    const elapsed = now - previous;
    if (elapsed < this.magicLinkThrottleMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil((this.magicLinkThrottleMs - elapsed) / 1000));
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'magic_link',
        code: 'auth_magic_link_throttled',
        severity: 'warning',
        summary: 'Magic-link request was throttled.',
        payload: {
          email,
          retryAfterSeconds,
        },
      });
      throw new Error(`Please wait ${retryAfterSeconds} seconds before requesting another magic link.`);
    }
    this.lastMagicLinkRequestAtByEmail.set(email, now);
  }

  private verifyUserEmail(
    user: User,
    email: string,
    options: {
      consumeTokenHash?: string;
      devAutoVerified?: boolean;
    } = {},
  ): User {
    const updatedUser: User = {
      ...user,
      email,
      accountStatus: 'verified',
      emailVerificationStatus: 'verified',
      lastVerifiedLoginAt: this.now(),
      temporarySessionExpiresAt: null,
      updatedAt: this.now(),
    };

    this.repository.runInTransaction(() => {
      this.repository.upsertUser(updatedUser);
      if (options.consumeTokenHash) {
        this.repository.consumeMagicLinkToken(options.consumeTokenHash, this.now());
      }
    });

    this.recordEvent('email_verified', updatedUser.id, {
      userId: updatedUser.id,
      email: updatedUser.email,
      ...(options.devAutoVerified ? { devAutoVerified: true } : {}),
    });

    return updatedUser;
  }

  private maybeAutoVerifyMagicLink(user: User, created: { record: StoredMagicLinkToken }): User {
    if (!isDevAutoVerifyMagicLinkEnabled()) {
      return user;
    }

    return this.verifyUserEmail(user, created.record.email, {
      consumeTokenHash: created.record.tokenHash,
      devAutoVerified: true,
    });
  }

  getSessionContext(rawSessionToken: string | null): SessionContext | null {
    if (!rawSessionToken) {
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'session',
        code: 'auth_session_missing',
        severity: 'info',
        summary: 'No session token was present on the request.',
        payload: {},
      });
      return null;
    }
    const session = this.repository.getSessionByTokenHash(sha256(rawSessionToken));
    if (!session) {
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'session',
        code: 'auth_session_unknown',
        severity: 'warning',
        summary: 'Session token did not match any stored session.',
        payload: {},
      });
      return null;
    }
    const user = this.repository.getUserById(session.userId);
    if (!user) {
      this.repository.deleteSessionByTokenHash(session.tokenHash);
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'session',
        code: 'auth_session_orphaned',
        severity: 'warning',
        summary: 'Session referenced a missing user record.',
        userId: session.userId,
        payload: {
          sessionId: session.id,
        },
      });
      return null;
    }
    const now = this.clock();
    if (new Date(session.expiresAt).getTime() < now.getTime() || isTemporaryAccessExpired(user, now)) {
      this.repository.deleteSessionByTokenHash(session.tokenHash);
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'session',
        code: 'auth_session_expired',
        severity: 'warning',
        summary: 'Session expired before the request could be handled.',
        userId: user.id,
        payload: {
          sessionId: session.id,
          expiresAt: session.expiresAt,
          temporaryAccessExpired: isTemporaryAccessExpired(user, now),
        },
      });
      return null;
    }
    const updatedSession: SessionRecord = {
      ...session,
      updatedAt: this.now(),
      lastSeenAt: this.now(),
      expiresAt: user.accountStatus === 'verified'
        ? this.buildSessionExpiry(user)
        : session.expiresAt,
    };
    this.repository.upsertSession(updatedSession);
    this.recordDiagnosticEvent({
      area: 'auth',
      stage: 'session',
      code: 'auth_session_resolved',
      severity: 'info',
      summary: 'Authenticated session resolved successfully.',
      userId: user.id,
      payload: {
        sessionId: updatedSession.id,
        accessLevel: updatedSession.accessLevel,
        expiresAt: updatedSession.expiresAt,
      },
    });
    return {
      session: updatedSession,
      user,
    };
  }

  getAuthSession(rawSessionToken: string | null): AuthSessionResponse {
    const context = this.getSessionContext(rawSessionToken);
    if (!context) {
      return {
        authenticated: false,
        accessLevel: 'anonymous',
        user: null,
        sessionExpiresAt: null,
        returnAccessRequiresVerification: false,
        emailCollectionRequired: false,
      };
    }
    return {
      authenticated: true,
      accessLevel: getAccessLevel(context.user),
      user: context.user,
      sessionExpiresAt: context.session.expiresAt,
      returnAccessRequiresVerification: requiresVerificationForReturnAccess(context.user),
      emailCollectionRequired: requiresEmailCollection(context.user),
    };
  }

  private evaluateJobInternal(userId: string, jobId: string, bypassDailyLimit: boolean): EvaluateJobResponse {
    const existingEvaluation = this.repository.getActiveEvaluationByJobId(jobId);
    this.recordEvent(existingEvaluation ? 'reevaluation_requested' : 'evaluation_started', userId, {
      userId,
      jobId,
      trackerItemId: this.repository.getTrackerItemByJobId(jobId)?.id,
    });

    if (existingEvaluation) {
      this.recordEvent('evaluation_started', userId, {
        userId,
        jobId,
        trackerItemId: this.repository.getTrackerItemByJobId(jobId)?.id,
        reevaluation: true,
      });
    }
    this.recordDiagnosticEvent({
      area: 'evaluation',
      stage: 'start',
      code: existingEvaluation ? 'evaluation_reevaluation_started' : 'evaluation_started',
      severity: 'info',
      summary: existingEvaluation ? 'Reevaluation started for the tracker item.' : 'Evaluation started for the tracker item.',
      userId,
      jobId,
      trackerItemId: this.repository.getTrackerItemByJobId(jobId)?.id ?? null,
      payload: {
        bypassDailyLimit,
        existingEvaluationId: existingEvaluation?.id ?? null,
      },
    });

    try {
      const detail = this.repository.getTrackerDetailByJobId(jobId);
      const job = detail.job;
      if (!job || job.userId !== userId) {
        throw new Error(`Job ${jobId} was not found.`);
      }

      const setup = this.repository.getSetupStateForUser(userId);
      if (!setup?.preferenceProfile || setup.cvProfiles.length === 0) {
        throw new Error('Setup must be completed before evaluation.');
      }

      const user = this.repository.getUserById(userId);
      if (!user) {
        throw new Error(`User ${userId} was not found.`);
      }

      if (!bypassDailyLimit && user.accountStatus === 'verified') {
        const evaluationsToday = this.repository.countEvaluationsForUserOnDay(userId, this.now().slice(0, 10));
        if (evaluationsToday >= this.dailyEvaluationLimit) {
          throw new Error(`Daily evaluation limit reached for verified users (${this.dailyEvaluationLimit}/day).`);
        }
      }

      const orderedCvProfiles = [...setup.cvProfiles].sort((left, right) => {
        if (user.defaultCvId) {
          const leftIsDefault = left.cvId === user.defaultCvId;
          const rightIsDefault = right.cvId === user.defaultCvId;
          if (leftIsDefault !== rightIsDefault) {
            return Number(rightIsDefault) - Number(leftIsDefault);
          }
        }
        return left.cvId.localeCompare(right.cvId);
      });

      const evaluation = evaluateJob(
        {
          job,
          cvProfiles: orderedCvProfiles,
          preferenceProfile: setup.preferenceProfile,
          reviewGateStatus: detail.validation?.status ?? 'review_required',
          preferredCvId: user.defaultCvId,
        },
        'evaluation-v1',
        'scoring-v1',
      );

      const currentTracker = detail.trackerItem ?? createTrackerItem(job, evaluation, this.clock);
      const updatedTracker = updateTrackerFromEvaluation(currentTracker, evaluation, this.clock);
      const recommendedCvName = evaluation.recommendedCvId
        ? orderedCvProfiles.find((profile) => profile.cvId === evaluation.recommendedCvId)?.cvName ?? null
        : null;

      this.repository.runInTransaction(() => {
        this.repository.saveEvaluation(userId, evaluation);
        this.repository.saveTrackerItem(updatedTracker);
      });

      this.recordEvent('evaluation_completed', userId, {
        userId,
        jobId,
        trackerItemId: updatedTracker.id,
        recommendedCvId: evaluation.recommendedCvId,
        evaluationVersion: evaluation.evaluationVersion,
        verdict: evaluation.verdict,
      });
      this.recordDiagnosticEvent({
        area: 'evaluation',
        stage: 'completed',
        code: 'evaluation_completed',
        severity: 'info',
        summary: 'Evaluation completed successfully.',
        userId,
        jobId,
        trackerItemId: updatedTracker.id,
        payload: {
          evaluationId: evaluation.id,
          verdict: evaluation.verdict,
          recommendedCvId: evaluation.recommendedCvId,
          reviewGateStatus: evaluation.reviewGateStatus,
          informationQualityScore: evaluation.informationQualityScore,
          totalScore: evaluation.totalScore,
          unknownDataFlags: evaluation.unknownDataFlags,
          normalizedComparisonDescriptors: this.hasEyeSession() ? evaluation.normalizedComparisonDescriptors : undefined,
          evaluatedCvResults: this.hasEyeSession()
            ? evaluation.evaluatedCvResults.map((entry) => ({
                cvId: entry.cvId,
                totalScore: entry.totalScore,
                hardSkipApplied: entry.hardSkipApplied,
                criterionScores: entry.criterionScores,
                subcriterionScores: entry.subcriterionScores,
                appliedPenalties: entry.appliedPenalties,
              }))
            : undefined,
          criterionScores: this.hasEyeSession() ? evaluation.criterionScores : undefined,
          subcriterionScores: this.hasEyeSession() ? evaluation.subcriterionScores : undefined,
          appliedPenalties: this.hasEyeSession() ? evaluation.appliedPenalties : undefined,
          hardSkipReasons: evaluation.explanationEvidencePayload.hardSkipReasons,
          recommendationReasons: evaluation.explanationEvidencePayload.recommendationReasons,
          decisionTrace: this.hasEyeSession() ? evaluation.decisionTrace : undefined,
        },
      });
      if (existingEvaluation) {
        this.recordEvent('reevaluation_completed', userId, {
          userId,
          jobId,
          trackerItemId: updatedTracker.id,
          recommendedCvId: evaluation.recommendedCvId,
          evaluationVersion: evaluation.evaluationVersion,
          verdict: evaluation.verdict,
        });
      }

      return {
        evaluation,
        trackerItem: updatedTracker,
        recommendedCvName,
      };
    } catch (error) {
      this.recordDiagnosticEvent({
        area: 'evaluation',
        stage: 'failed',
        code: 'evaluation_failed',
        severity: 'error',
        summary: 'Evaluation failed before completion.',
        userId,
        jobId,
        payload: {
          errorMessage: error instanceof Error ? error.message : 'Unknown evaluation error.',
          bypassDailyLimit,
        },
      });
      this.recordEvent('evaluation_failed', userId, {
        userId,
        jobId,
        errorMessage: error instanceof Error ? error.message : 'Unknown evaluation error.',
      });
      throw error;
    }
  }

  private reevaluateTrackedJobs(userId: string): string[] {
    const trackedJobs = this.repository
      .listTrackerDetailsByUser(userId)
      .map((detail) => detail.job?.id ?? null)
      .filter((jobId): jobId is string => Boolean(jobId));
    const reevaluatedJobIds: string[] = [];

    for (const jobId of trackedJobs) {
      try {
        const result = this.evaluateJobInternal(userId, jobId, true);
        reevaluatedJobIds.push(result.evaluation.jobId);
      } catch {
        // Leave the existing tracker record intact when a reevaluation cannot run.
      }
    }

    return unique(reevaluatedJobIds);
  }

  private buildPositiveTrackerHistory(userId: string): Array<{ title: string | null; company: string | null; keywords: string[]; outcome: string }> {
    return this.repository
      .listTrackerDetailsByUser(userId)
      .filter((detail) => {
        const status = detail.trackerItem?.currentStatus;
        if (!status || !['applied', 'interviewing', 'offer'].includes(status)) {
          return false;
        }
        if (detail.trackerItem?.recommendedCvDecision === 'overridden' || detail.trackerItem?.verdictDecision === 'overridden') {
          return false;
        }
        return Boolean(detail.job);
      })
      .map((detail) => ({
        title: detail.job?.normalizedJobObject.title ?? null,
        company: detail.job?.normalizedJobObject.company ?? null,
        keywords: detail.job?.normalizedJobObject.keywords ?? [],
        outcome: detail.trackerItem?.currentStatus ?? 'saved',
      }));
  }

  private buildPreferenceAudits(profile: PreferenceProfile): SetupBootstrapResponse['preferenceAudits'] {
    return normalizePreferenceProfile(profile).audits;
  }

  private buildSetupAiArtifacts(cvProfiles: CVProfile[], preferenceProfile: PreferenceProfile | null): AiArtifactReference[] {
    return buildSetupArtifactSummaries(
      this.repository,
      cvProfiles.map((profile) => profile.id),
      preferenceProfile?.id ?? null,
    );
  }

  private buildUploadToken(upload: ParsedMultipartUpload): string {
    return sha256(`${upload.fileName}:${upload.mimeType}:${createHash('sha256').update(upload.buffer).digest('hex')}`).slice(0, 24);
  }

  private toUploadAnalysisResult(item: AnalyzedCvUpload): CvUploadAnalysisResult {
    return {
      uploadToken: item.uploadToken,
      fileName: item.upload.fileName,
      mimeType: item.upload.mimeType,
      status: item.status,
      classification: item.classification,
      warning: item.warning,
      extractedTextLength: item.extraction?.rawText.length ?? 0,
      candidateMatches: item.candidateMatches,
    };
  }

  private async analyzeCvUploadsInternal(
    userId: string | null,
    uploads: ParsedMultipartUpload[],
    args: {
      existingCvs?: StoredCvFile[];
      existingProfiles?: CVProfile[];
    } = {},
  ): Promise<AnalyzedCvUpload[]> {
    const existingCvs = args.existingCvs ?? [];
    const existingProfiles = args.existingProfiles ?? [];
    const analyzed: AnalyzedCvUpload[] = [];

    for (const upload of uploads) {
      const uploadToken = this.buildUploadToken(upload);
      const classification = (await this.ai.classifyCvFile(userId, uploadToken, {
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        buffer: upload.buffer,
      })).output;

      if (!classification.isResume) {
        analyzed.push({
          upload,
          uploadToken,
          classification,
          extraction: null,
          status: 'rejected_non_cv',
          warning: `${upload.fileName} was rejected as a non-CV file: ${classification.reason}`,
          contentHash: null,
          candidateMatches: [],
        });
        continue;
      }

      const extraction = await extractTextFromUpload(upload);
      const contentHash = extraction.rawText.trim() ? hashCvContent(extraction.rawText) : null;
      const candidateMatches = userId
        ? buildCvMatchCandidates(
            {
              fileName: upload.fileName,
              rawText: extraction.rawText,
              contentHash,
            },
            existingCvs,
            existingProfiles,
          )
        : [];

      analyzed.push({
        upload,
        uploadToken,
        classification,
        extraction,
        status: candidateMatches.length > 0 ? 'resolution_required' : 'accepted',
        warning: extraction.warning,
        contentHash,
        candidateMatches,
      });
    }

    return analyzed;
  }

  private async buildCvProfileForStoredCv(
    userId: string,
    cv: StoredCvFile,
    args: {
      existingProfile?: CVProfile | null;
      triggerReasons?: string[];
      relatedProfileId?: string | null;
    } = {},
  ): Promise<CVProfile | null> {
    if (!cv.rawText?.trim()) {
      return null;
    }

    const baselineProfile = createCvProfile(userId, cv, this.clock);
    const profileId = args.existingProfile?.id ?? args.relatedProfileId ?? baselineProfile.id;
    const suggestion = await this.ai.suggestCvProfile(userId, profileId, {
      rawText: cv.rawText,
      fileName: cv.fileName,
      triggerReasons: args.triggerReasons ?? [],
    });
    const suggestedProfile = applyCvSuggestion(
      {
        ...baselineProfile,
        id: profileId,
      },
      suggestion?.output ?? null,
      suggestion?.artifactReference ?? null,
    );

    if (!args.existingProfile) {
      return suggestedProfile;
    }

    return {
      ...applyExistingCvProfileDecisions(args.existingProfile, suggestedProfile),
      updatedAt: this.now(),
    };
  }

  private buildCvListResponse(userId: string): CvListResponse {
    const user = this.repository.getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} was not found.`);
    }
    const cvProfiles = this.repository.listCvProfilesByUser(userId);
    const items = this.repository.listStoredCvsByUser(userId).map((cv) => ({
      cv: toPublicCv(cv),
      cvProfile: cvProfiles.find((profile) => profile.cvId === cv.id) ?? null,
      isDefault: user.defaultCvId === cv.id,
      versionCount: this.repository.listCvVersionsByCvId(cv.id).length,
      lastUpdatedAt: cv.updatedAt,
    }));

    return {
      items,
      defaultCvId: user.defaultCvId,
    };
  }

  private async refreshSetupSuggestionsInternal(userId: string, reevaluateTrackedJobs: boolean): Promise<{
    cvProfiles: CVProfile[];
    preferenceProfile: PreferenceProfile;
    reevaluatedJobIds: string[];
  }> {
    const setup = this.repository.getSetupStateForUser(userId);
    if (!setup?.preferenceProfile) {
      throw new Error('Setup must be completed before refreshing suggestions.');
    }

    const refreshedProfiles: CVProfile[] = [];
    for (const profile of setup.cvProfiles) {
      const cv = setup.cvs.find((candidate) => candidate.id === profile.cvId);
      if (!cv?.rawText?.trim()) {
        refreshedProfiles.push(profile);
        continue;
      }
      const suggestion = await this.ai.suggestCvProfile(userId, profile.id, {
        rawText: cv.rawText,
        fileName: cv.fileName,
      });
      refreshedProfiles.push(applyCvSuggestion(profile, suggestion?.output ?? null, suggestion?.artifactReference ?? null));
    }

    const preferenceSuggestion = await this.ai.suggestPreferences(userId, setup.preferenceProfile.id, {
      cvProfiles: refreshedProfiles.map((profile) => ({
        primaryRole: profile.primaryRole,
        secondaryRoles: profile.secondaryRoles,
        seniority: profile.seniority,
        careerTrack: profile.careerTrack,
        coreStack: profile.coreStack,
        excludedDomains: profile.excludedDomains,
      })),
      currentPreferences: setup.preferenceProfile,
      positiveHistory: this.buildPositiveTrackerHistory(userId),
    });

    const refreshedPreferenceProfile = applyPreferenceSuggestion(
      setup.preferenceProfile,
      preferenceSuggestion?.output ?? null,
      preferenceSuggestion?.artifactReference ?? null,
    );

    const normalizedPreference = normalizePreferenceProfile({
      ...refreshedPreferenceProfile,
      updatedAt: this.now(),
    });

    this.repository.runInTransaction(() => {
      for (const profile of refreshedProfiles) {
        this.repository.saveCvProfile({
          ...profile,
          updatedAt: this.now(),
        });
      }
      this.repository.savePreferenceProfile(normalizedPreference.profile);
    });

    const reevaluatedJobIds = reevaluateTrackedJobs ? this.reevaluateTrackedJobs(userId) : [];
    return {
      cvProfiles: refreshedProfiles.map((profile) => ({
        ...profile,
        updatedAt: this.now(),
      })),
      preferenceProfile: normalizedPreference.profile,
      reevaluatedJobIds,
    };
  }

  trackAnalyticsEvent(context: SessionContext | null, input: TrackAnalyticsEventRequest): TrackAnalyticsEventResponse {
    if (!context?.user) {
      throw new Error('Analytics tracking requires an authenticated session.');
    }

    this.recordEvent(input.name, context.user.id, {
      ...(input.properties ?? {}),
      userId: context.user.id,
    });

    return { ok: true };
  }

  async bootstrapFromUploads(uploads: ParsedMultipartUpload[]): Promise<SetupBootstrapResponse & { sessionToken: string; sessionExpiresAt: string }> {
    validateCvUploads(uploads, getMaxCvUploadCount(), getMaxCvUploadBytes());

    this.recordEvent('cv_upload_started', null, {
      uploadCount: uploads.length,
      fileNames: uploads.map((upload) => upload.fileName),
    });

    const analyzedUploads = await this.analyzeCvUploadsInternal(null, uploads);
    const acceptedUploads = analyzedUploads.filter((item) => item.status !== 'rejected_non_cv');
    if (acceptedUploads.length === 0) {
      throw new Error('No CV/resume files were accepted from the uploaded files.');
    }

    const rawTextsForEmail = acceptedUploads.map((item) => `${item.upload.fileName} ${item.extraction?.rawText ?? ''}`);
    const { preferredEmail, detectedEmails } = choosePreferredEmail(rawTextsForEmail);
    const auth = new InMemoryAuthSessionService(this.clock);
    const initialized = auth.initializeUserFromCv(
      preferredEmail
        ? {
            detectedEmails,
            preferredEmail,
          }
        : {
            detectedEmails,
          },
    );

    const warnings = [
      ...initialized.warnings,
      ...analyzedUploads.map((item) => item.warning).filter((value): value is string => Boolean(value)),
    ];
    let user = initialized.user;
    const persistedCvs: StoredCvFile[] = [];
    const cvProfiles: SetupBootstrapResponse['cvProfiles'] = [];
    const persistedVersions: StoredCvVersion[] = [];

    for (const item of acceptedUploads) {
      const upload = item.upload;
      const extraction = item.extraction;
      if (!extraction) {
        continue;
      }
      const cvId = createId('cv');
      const versionId = createId('cvv');
      const storedFilePath = await persistUploadBinary(getUploadsDir(), user.id, versionId, upload);
      const timestamp = this.now();
      const version = buildStoredCvVersion({
        versionId,
        cvId,
        userId: user.id,
        upload,
        storedFilePath,
        rawText: extraction.rawText,
        classification: item.classification,
        uploadedAt: timestamp,
      });
      const extractedEmail = extractEmails(`${upload.fileName} ${extraction.rawText}`)[0] ?? null;
      const cv = buildStoredCvFile({
        cvId,
        userId: user.id,
        upload,
        version,
        extractedEmail,
        uploadedAt: timestamp,
        extractionWarning: extraction.warning,
      });
      persistedCvs.push(cv);
      persistedVersions.push(version);
      if (cv.processingStatus === 'profile_generated') {
        const profile = createCvProfile(user.id, cv, this.clock);
        cvProfiles.push(profile);
        this.recordEvent('cv_profile_generated', user.id, {
          userId: user.id,
          cvId: cv.id,
          primaryRole: profile.primaryRole,
        });
      }
    }

    if (cvProfiles.length === 0) {
      throw new Error('No readable CV text could be extracted from the uploaded files.');
    }

    const multiCvConflictDetected = unique(
      cvProfiles.map((profile) => `${profile.primaryRole ?? ''}|${profile.careerTrack ?? ''}`).filter(Boolean),
    ).length > 1;
    const aiEnhancedProfiles: CVProfile[] = [];
    for (const profile of cvProfiles) {
      const cv = persistedCvs.find((candidate) => candidate.id === profile.cvId);
      const suggestion = cv?.rawText?.trim()
        ? await this.ai.suggestCvProfile(user.id, profile.id, {
            rawText: cv.rawText,
            fileName: cv.fileName,
            triggerReasons: [
              ...(profile.primaryRole ? [] : ['missing_primary_role']),
              ...(profile.seniority === 'unknown' ? ['unknown_seniority'] : []),
              ...(profile.careerTrack ? [] : ['unknown_career_track']),
              ...(multiCvConflictDetected ? ['multi_cv_positioning_conflict'] : []),
            ],
          })
        : null;
      aiEnhancedProfiles.push(applyCvSuggestion(profile, suggestion?.output ?? null, suggestion?.artifactReference ?? null));
    }

    const preferenceProfile = buildSmartDefaultPreferenceProfile({
      userId: user.id,
      cvProfiles: aiEnhancedProfiles,
      clock: this.clock,
    });
    const aiPreferenceSuggestion = await this.ai.suggestPreferences(user.id, preferenceProfile.id, {
      cvProfiles: aiEnhancedProfiles.map((profile) => ({
        primaryRole: profile.primaryRole,
        secondaryRoles: profile.secondaryRoles,
        seniority: profile.seniority,
        careerTrack: profile.careerTrack,
        coreStack: profile.coreStack,
        excludedDomains: profile.excludedDomains,
      })),
      currentPreferences: preferenceProfile,
      positiveHistory: [],
    });
    const mergedPreferenceProfile = applyPreferenceSuggestion(
      preferenceProfile,
      aiPreferenceSuggestion?.output ?? null,
      aiPreferenceSuggestion?.artifactReference ?? null,
    );
    const normalizedPreferenceProfile = normalizePreferenceProfile({
      ...mergedPreferenceProfile,
      updatedAt: this.now(),
    });
    user.defaultCvId = aiEnhancedProfiles[0]?.cvId ?? persistedCvs[0]?.id ?? null;
    user.updatedAt = this.now();

    this.repository.runInTransaction(() => {
      this.repository.upsertUser(user);
      for (const cv of persistedCvs) {
        this.repository.saveStoredCv(cv);
      }
      for (const version of persistedVersions) {
        this.repository.saveCvVersion(version);
      }
      for (const profile of aiEnhancedProfiles) {
        this.repository.saveCvProfile(profile);
      }
      this.repository.savePreferenceProfile(normalizedPreferenceProfile.profile);
    });

    if (user.email) {
      const created = await this.createMagicLink(user, user.email);
      if (isDevAutoVerifyMagicLinkEnabled()) {
        user = this.maybeAutoVerifyMagicLink(user, created);
      } else if (created.deliveryFailed) {
        warnings.push(`Magic-link delivery failed for ${user.email}. Use the dev outbox or retry after fixing email transport.`);
      }
      this.recordEvent('magic_link_sent', user.id, { userId: user.id, email: user.email });
    }

    this.recordEvent('cv_upload_completed', user.id, { userId: user.id, cvCount: persistedCvs.length });
    if (detectedEmails.length > 0) {
      this.recordEvent('email_extracted', user.id, { userId: user.id, detectedEmails });
    }
    this.recordEvent('setup_minimum_ready', user.id, { userId: user.id, cvProfileCount: cvProfiles.length });

    const session = this.createSession(user);
    const setupAiArtifacts = this.buildSetupAiArtifacts(aiEnhancedProfiles, normalizedPreferenceProfile.profile);
    const preferenceAudits = this.buildPreferenceAudits(normalizedPreferenceProfile.profile);

    return {
      ...toPublicSetupResponse(
        user,
        persistedCvs,
        aiEnhancedProfiles,
        normalizedPreferenceProfile.profile,
        detectedEmails,
        initialized.selectedEmail,
        warnings,
        setupAiArtifacts,
        preferenceAudits,
      ),
      sessionToken: session.rawToken,
      sessionExpiresAt: session.session.expiresAt,
      uploadResults: analyzedUploads.map((item) => this.toUploadAnalysisResult(item)),
    };
  }

  getSetupCurrent(userId: string): SetupCurrentResponse {
    const setup = this.repository.getSetupStateForUser(userId);
    if (!setup || !setup.preferenceProfile) {
      return { bootstrap: null };
    }
    const detectedEmails = unique(setup.cvs.map((cv) => cv.extractedEmail ?? '').filter(Boolean));
    const preferenceAudits = this.buildPreferenceAudits(setup.preferenceProfile);
    return {
      bootstrap: toPublicSetupResponse(
        setup.user,
        setup.cvs,
        setup.cvProfiles,
        setup.preferenceProfile,
        detectedEmails,
        setup.user.email ?? detectedEmails[0] ?? null,
        [],
        this.buildSetupAiArtifacts(setup.cvProfiles, setup.preferenceProfile),
        preferenceAudits,
      ),
    };
  }

  listCvs(userId: string): CvListResponse {
    return this.buildCvListResponse(userId);
  }

  getCvDetail(userId: string, cvId: string): CvDetailResponse {
    const user = this.repository.getUserById(userId);
    const cv = this.repository.getStoredCvById(cvId);
    if (!user || !cv || cv.userId !== userId) {
      throw new Error(`CV ${cvId} was not found.`);
    }

    return {
      cv: toPublicCv(cv),
      cvProfile: this.repository.getCvProfileByCvId(cvId),
      versions: this.repository.listCvVersionsByCvId(cvId).map(toPublicCvVersion),
      isDefault: user.defaultCvId === cvId,
    };
  }

  async analyzeCvUploads(userId: string, uploads: ParsedMultipartUpload[]): Promise<AnalyzeCvUploadResponse> {
    validateCvUploads(uploads, getMaxCvUploadCount(), getMaxCvUploadBytes());
    const setup = this.repository.getSetupStateForUser(userId);
    if (!setup?.preferenceProfile) {
      throw new Error('Setup must be completed before adding or updating CVs.');
    }

    const analyzed = await this.analyzeCvUploadsInternal(userId, uploads, {
      existingCvs: setup.cvs,
      existingProfiles: setup.cvProfiles,
    });

    return {
      items: analyzed.map((item) => this.toUploadAnalysisResult(item)),
    };
  }

  async commitCvUploads(
    userId: string,
    uploads: ParsedMultipartUpload[],
    decisions: CvUploadCommitDecision[],
  ): Promise<CommitCvUploadResponse> {
    validateCvUploads(uploads, getMaxCvUploadCount(), getMaxCvUploadBytes());
    const setup = this.repository.getSetupStateForUser(userId);
    if (!setup?.preferenceProfile) {
      throw new Error('Setup must be completed before adding or updating CVs.');
    }

    const analyzed = await this.analyzeCvUploadsInternal(userId, uploads, {
      existingCvs: setup.cvs,
      existingProfiles: setup.cvProfiles,
    });
    const decisionByToken = new Map(decisions.map((decision) => [decision.uploadToken, decision]));
    const cvMap = new Map(setup.cvs.map((cv) => [cv.id, cv]));
    const profileMap = new Map(setup.cvProfiles.map((profile) => [profile.cvId, profile]));
    const warnings = analyzed.map((item) => item.warning).filter((value): value is string => Boolean(value));
    const committedItems: CommitCvUploadResponse['items'] = [];
    const persistedVersions: StoredCvVersion[] = [];
    const persistedCvs: StoredCvFile[] = [];
    const persistedProfiles: CVProfile[] = [];

    for (const item of analyzed) {
      if (item.status === 'rejected_non_cv') {
        continue;
      }

      const extraction = item.extraction;
      if (!extraction) {
        continue;
      }

      const explicitDecision = decisionByToken.get(item.uploadToken) ?? null;
      const decision =
        item.status === 'resolution_required'
          ? explicitDecision
          : explicitDecision ?? {
              uploadToken: item.uploadToken,
              decision: 'create_new' as const,
              targetCvId: null,
            };

      if (!decision) {
        throw new Error(`Upload ${item.upload.fileName} requires an explicit create-new or update-existing decision.`);
      }

      if (decision.decision === 'update_existing') {
        if (!decision.targetCvId) {
          throw new Error(`A target CV is required when updating ${item.upload.fileName}.`);
        }
        const existingCv = cvMap.get(decision.targetCvId);
        if (!existingCv || existingCv.userId !== userId) {
          throw new Error(`Target CV ${decision.targetCvId} was not found.`);
        }
        if (!item.candidateMatches.some((candidate) => candidate.candidateCvId === decision.targetCvId)) {
          throw new Error(`Target CV ${decision.targetCvId} was not returned as a strong match for ${item.upload.fileName}.`);
        }

        const existingProfile = profileMap.get(existingCv.id) ?? null;
        const previousVersion = existingCv.latestVersionId ? this.repository.getCvVersionById(existingCv.latestVersionId) : null;
        const timestamp = this.now();
        const versionId = createId('cvv');
        const storedFilePath = await persistUploadBinary(getUploadsDir(), userId, versionId, item.upload);
        if (previousVersion) {
          persistedVersions.push({
            ...previousVersion,
            supersededAt: timestamp,
          });
        }
        const nextVersion = buildStoredCvVersion({
          versionId,
          cvId: existingCv.id,
          userId,
          upload: item.upload,
          storedFilePath,
          rawText: extraction.rawText,
          classification: item.classification,
          uploadedAt: timestamp,
        });
        const extractedEmail = extractEmails(`${item.upload.fileName} ${extraction.rawText}`)[0] ?? existingCv.extractedEmail ?? null;
        const updatedCv = buildStoredCvFile({
          cvId: existingCv.id,
          userId,
          upload: item.upload,
          version: nextVersion,
          extractedEmail,
          uploadedAt: timestamp,
          existingUploadedAt: existingCv.uploadedAt,
          extractionWarning: extraction.warning,
        });
        const updatedProfile = existingProfile
          ? await this.buildCvProfileForStoredCv(userId, updatedCv, {
              existingProfile,
              triggerReasons: ['cv_updated'],
            })
          : await this.buildCvProfileForStoredCv(userId, updatedCv, {
              triggerReasons: ['cv_updated'],
            });

        cvMap.set(updatedCv.id, updatedCv);
        if (updatedProfile) {
          profileMap.set(updatedCv.id, updatedProfile);
          persistedProfiles.push(updatedProfile);
        }
        persistedVersions.push(nextVersion);
        persistedCvs.push(updatedCv);
        committedItems.push({
          uploadToken: item.uploadToken,
          fileName: item.upload.fileName,
          status: 'updated_existing',
          cvId: updatedCv.id,
        });
        continue;
      }

      const cvId = createId('cv');
      const timestamp = this.now();
      const versionId = createId('cvv');
      const storedFilePath = await persistUploadBinary(getUploadsDir(), userId, versionId, item.upload);
      const version = buildStoredCvVersion({
        versionId,
        cvId,
        userId,
        upload: item.upload,
        storedFilePath,
        rawText: extraction.rawText,
        classification: item.classification,
        uploadedAt: timestamp,
      });
      const extractedEmail = extractEmails(`${item.upload.fileName} ${extraction.rawText}`)[0] ?? null;
      const cv = buildStoredCvFile({
        cvId,
        userId,
        upload: item.upload,
        version,
        extractedEmail,
        uploadedAt: timestamp,
        extractionWarning: extraction.warning,
      });
      const profile = await this.buildCvProfileForStoredCv(userId, cv, {
        triggerReasons: ['new_cv_upload'],
      });

      cvMap.set(cv.id, cv);
      if (profile) {
        profileMap.set(cv.id, profile);
        persistedProfiles.push(profile);
      }
      persistedVersions.push(version);
      persistedCvs.push(cv);
      committedItems.push({
        uploadToken: item.uploadToken,
        fileName: item.upload.fileName,
        status: 'created_new',
        cvId: cv.id,
      });
    }

    if (committedItems.length === 0) {
      throw new Error('No accepted CV uploads were available to commit.');
    }

    const user = this.repository.getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} was not found.`);
    }

    const effectiveCvs = [...cvMap.values()];
    const { preferredEmail, detectedEmails } = choosePreferredEmail(
      effectiveCvs.map((cv) => `${cv.fileName} ${cv.rawText ?? ''}`),
    );

    let nextUser: User = {
      ...user,
      email: user.accountStatus === 'verified' ? user.email : (preferredEmail ?? user.email),
      accountStatus:
        user.accountStatus === 'verified'
          ? 'verified'
          : preferredEmail ?? user.email
            ? 'unverified'
            : 'temporary',
      emailVerificationStatus:
        user.accountStatus === 'verified'
          ? 'verified'
          : preferredEmail ?? user.email
            ? 'pending'
            : 'unverified',
      defaultCvId: user.defaultCvId ?? committedItems[0]?.cvId ?? null,
      temporarySessionExpiresAt:
        user.accountStatus === 'verified'
          ? null
          : new Date(this.clock().getTime() + 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: this.now(),
    };

    this.repository.runInTransaction(() => {
      this.repository.upsertUser(nextUser);
      for (const version of persistedVersions) {
        this.repository.saveCvVersion(version);
      }
      for (const cv of persistedCvs) {
        this.repository.saveStoredCv(cv);
      }
      for (const profile of persistedProfiles) {
        this.repository.saveCvProfile(profile);
      }
    });

    if (nextUser.email && nextUser.accountStatus !== 'verified') {
      const created = await this.createMagicLink(nextUser, nextUser.email);
      if (isDevAutoVerifyMagicLinkEnabled()) {
        nextUser = this.maybeAutoVerifyMagicLink(nextUser, created);
      } else if (created.deliveryFailed) {
        warnings.push(`Magic-link delivery failed for ${nextUser.email}. Use the dev outbox or retry after fixing email transport.`);
      }
      this.recordEvent('magic_link_sent', nextUser.id, { userId: nextUser.id, email: nextUser.email });
    }

    for (const committed of committedItems) {
      this.recordEvent('cv_profile_generated', userId, {
        userId,
        cvId: committed.cvId,
        action: committed.status,
      });
    }

    if (persistedProfiles.length > 0) {
      await this.refreshSetupSuggestionsInternal(userId, false);
    }

    const reevaluatedJobIds = persistedProfiles.length > 0 ? this.reevaluateTrackedJobs(userId) : [];
    const refreshedSetup = this.repository.getSetupStateForUser(userId);
    if (!refreshedSetup?.preferenceProfile) {
      throw new Error('Updated setup could not be loaded.');
    }

    return {
      items: committedItems,
      bootstrap: {
        ...toPublicSetupResponse(
          refreshedSetup.user,
          refreshedSetup.cvs,
          refreshedSetup.cvProfiles,
          refreshedSetup.preferenceProfile,
          detectedEmails,
          preferredEmail ?? refreshedSetup.user.email,
          warnings,
          this.buildSetupAiArtifacts(refreshedSetup.cvProfiles, refreshedSetup.preferenceProfile),
          this.buildPreferenceAudits(refreshedSetup.preferenceProfile),
        ),
        uploadResults: analyzed.map((item) => this.toUploadAnalysisResult(item)),
      },
      reevaluatedJobIds,
    };
  }

  async uploadAdditionalCvs(userId: string, uploads: ParsedMultipartUpload[]): Promise<UploadAdditionalCvsResponse> {
    const analyzed = await this.analyzeCvUploads(userId, uploads);
    const unresolved = analyzed.items.filter((item) => item.status === 'resolution_required');
    if (unresolved.length > 0) {
      throw new Error('One or more uploads matched an existing CV. Use the CV manager analyze/commit flow to choose update or create-new.');
    }

    const committed = await this.commitCvUploads(
      userId,
      uploads,
      analyzed.items
        .filter((item) => item.status === 'accepted')
        .map((item) => ({
          uploadToken: item.uploadToken,
          decision: 'create_new' as const,
          targetCvId: null,
        })),
    );

    return {
      bootstrap: committed.bootstrap,
      addedCvIds: committed.items.filter((item) => item.status === 'created_new').map((item) => item.cvId),
      reevaluatedJobIds: committed.reevaluatedJobIds,
    };
  }

  setDefaultCv(userId: string, cvId: string, reevaluateTrackedJobs = true): SetDefaultCvResponse {
    const user = this.repository.getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} was not found.`);
    }
    const cvBelongsToUser = this.repository.listCvProfilesByUser(userId).some((profile) => profile.cvId === cvId);
    if (!cvBelongsToUser) {
      throw new Error(`CV ${cvId} does not belong to the current user.`);
    }

    const updatedUser: User = {
      ...user,
      defaultCvId: cvId,
      updatedAt: this.now(),
    };
    this.repository.upsertUser(updatedUser);
    const reevaluatedJobIds = reevaluateTrackedJobs ? this.reevaluateTrackedJobs(userId) : [];

    return {
      user: updatedUser,
      bootstrap: this.getSetupCurrent(userId).bootstrap,
      reevaluatedJobIds,
    };
  }

  updateCvProfile(userId: string, cvId: string, input: UpdateCvProfileRequest): UpdateCvProfileResponse {
    const existing = this.repository.getCvProfileByCvId(cvId);
    if (!existing || existing.userId !== userId) {
      throw new Error(`CV profile for ${cvId} was not found.`);
    }
    const valueMaps = buildCvProfileValueMaps(existing, input);
    const updated = {
      ...existing,
      cvName: input.cvName,
      primaryRole: input.primaryRole,
      secondaryRoles: unique(input.secondaryRoles),
      seniority: input.seniority,
      careerTrack: input.careerTrack,
      coreStack: unique(input.coreStack),
      positioningSummary: input.positioningSummary,
      excludedDomains: unique(input.excludedDomains),
      confirmedValues: valueMaps.confirmedValues,
      overrideValues: valueMaps.overrideValues,
      updatedAt: this.now(),
    };
    this.repository.saveCvProfile(updated);
    const reevaluatedJobIds = this.reevaluateTrackedJobs(userId);
    this.recordEvent('setup_review_completed', userId, {
      userId,
      cvId,
      section: 'cv_profile',
      reevaluatedJobCount: reevaluatedJobIds.length,
    });
    return { cvProfile: updated, reevaluatedJobIds };
  }

  updatePreferences(userId: string, input: UpdatePreferencesRequest): UpdatePreferencesResponse {
    const existing = this.repository.getPreferenceProfileByUser(userId);
    const updated = {
      ...(existing ?? input.preferenceProfile),
      ...input.preferenceProfile,
      id: existing?.id ?? input.preferenceProfile.id,
      userId,
      ...buildPreferenceValueMaps(existing, input.preferenceProfile),
      updatedAt: this.now(),
    };
    const normalized = normalizePreferenceProfile(updated);
    this.repository.savePreferenceProfile(normalized.profile);
    const reevaluatedJobIds = input.reevaluateTrackedJobs === false ? [] : this.reevaluateTrackedJobs(userId);
    this.recordEvent('setup_review_completed', userId, {
      userId,
      section: 'preferences',
      auditCount: normalized.audits.length,
      reevaluatedJobCount: reevaluatedJobIds.length,
    });
    return {
      preferenceProfile: normalized.profile,
      audits: normalized.audits,
      reevaluatedJobIds,
    };
  }

  async refreshSetupSuggestions(userId: string, reevaluateTrackedJobs = true): Promise<{
    bootstrap: SetupBootstrapResponse;
    reevaluatedJobIds: string[];
  }> {
    const refreshed = await this.refreshSetupSuggestionsInternal(userId, reevaluateTrackedJobs);
    const setup = this.repository.getSetupStateForUser(userId);
    if (!setup?.preferenceProfile) {
      throw new Error('Updated setup could not be loaded after refreshing suggestions.');
    }

    return {
      bootstrap: toPublicSetupResponse(
        setup.user,
        setup.cvs,
        setup.cvProfiles,
        setup.preferenceProfile,
        unique(setup.cvs.map((cv) => cv.extractedEmail ?? '').filter(Boolean)),
        setup.user.email,
        [],
        this.buildSetupAiArtifacts(setup.cvProfiles, setup.preferenceProfile),
        this.buildPreferenceAudits(setup.preferenceProfile),
      ),
      reevaluatedJobIds: refreshed.reevaluatedJobIds,
    };
  }

  async requestMagicLink(context: SessionContext | null, input: MagicLinkRequestRequest): Promise<MagicLinkRequestResponse> {
    const normalizedEmail = normalizeEmail(input.email);
    let user: User | null = null;
    this.recordDiagnosticEvent({
      area: 'auth',
      stage: 'magic_link',
      code: 'auth_magic_link_requested',
      severity: 'info',
      summary: 'Magic link request received.',
      userId: context?.user.id ?? null,
      payload: {
        email: normalizedEmail,
        authenticatedRequest: Boolean(context?.user),
      },
    });

    if (context?.user) {
      user = context.user;
      if (user.accountStatus === 'verified' && user.email && normalizeEmail(user.email) !== normalizedEmail) {
        throw new Error('Verified accounts cannot change email through the magic-link request route.');
      }
      user = {
        ...user,
        email: normalizedEmail,
        accountStatus: user.accountStatus === 'verified' ? 'verified' : 'unverified',
        emailVerificationStatus: user.accountStatus === 'verified' ? 'verified' : 'pending',
        temporarySessionExpiresAt: user.accountStatus === 'verified'
          ? null
          : new Date(this.clock().getTime() + 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: this.now(),
      };
      this.repository.upsertUser(user);
    } else {
      user = this.repository.getUserByEmail(normalizedEmail);
      if (!user) {
        throw new Error(`No account was found for ${normalizedEmail}.`);
      }
    }

    this.enforceMagicLinkThrottle(normalizedEmail);
    const created = await this.createMagicLink(user, normalizedEmail);
    if (context?.user && isDevAutoVerifyMagicLinkEnabled()) {
      this.maybeAutoVerifyMagicLink(user, created);
    } else if (created.deliveryFailed) {
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'magic_link',
        code: 'auth_magic_link_delivery_failed',
        severity: 'error',
        summary: 'Magic-link delivery failed.',
        userId: user.id,
        payload: {
          email: normalizedEmail,
          provider: created.outbox.deliveryProvider,
          errorMessage: created.outbox.errorMessage,
        },
      });
      throw new Error(created.outbox.errorMessage ?? `Failed to send magic link to ${normalizedEmail}.`);
    }
    this.recordEvent('magic_link_sent', user.id, { userId: user.id, email: normalizedEmail });
    this.recordDiagnosticEvent({
      area: 'auth',
      stage: 'magic_link',
      code: 'auth_magic_link_sent',
      severity: 'info',
      summary: 'Magic link was issued successfully.',
      userId: user.id,
      payload: {
        email: normalizedEmail,
        expiresAt: created.record.expiresAt,
        deliveryProvider: created.outbox.deliveryProvider,
        deliveryStatus: created.outbox.deliveryStatus,
      },
    });
    return {
      sentTo: normalizedEmail,
      expiresAt: context?.user && isDevAutoVerifyMagicLinkEnabled() ? null : created.record.expiresAt,
    };
  }

  consumeMagicLink(token: string, email?: string): MagicLinkConsumeResponse & { sessionToken: string | null; sessionExpiresAt: string | null } {
    const stored = this.repository.getMagicLinkTokenByHash(sha256(token));
    if (!stored) {
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'magic_link',
        code: 'auth_magic_link_consume_missing',
        severity: 'warning',
        summary: 'Magic-link consume failed because the token was not found.',
        payload: {
          email: email ? normalizeEmail(email) : null,
        },
      });
      return {
        verified: false,
        userId: null,
        accessLevel: 'temporary',
        user: null,
        sessionToken: null,
        sessionExpiresAt: null,
      };
    }
    if (stored.consumedAt || new Date(stored.expiresAt).getTime() < this.clock().getTime()) {
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'magic_link',
        code: 'auth_magic_link_consume_expired',
        severity: 'warning',
        summary: 'Magic-link consume failed because the token was expired or already used.',
        userId: stored.userId,
        payload: {
          email: stored.email,
          consumedAt: stored.consumedAt,
          expiresAt: stored.expiresAt,
        },
      });
      return {
        verified: false,
        userId: null,
        accessLevel: 'temporary',
        user: null,
        sessionToken: null,
        sessionExpiresAt: null,
      };
    }
    if (email && normalizeEmail(email) !== normalizeEmail(stored.email)) {
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'magic_link',
        code: 'auth_magic_link_consume_email_mismatch',
        severity: 'warning',
        summary: 'Magic-link consume failed because the email did not match the issued token.',
        userId: stored.userId,
        payload: {
          expectedEmail: stored.email,
          suppliedEmail: normalizeEmail(email),
        },
      });
      return {
        verified: false,
        userId: null,
        accessLevel: 'temporary',
        user: null,
        sessionToken: null,
        sessionExpiresAt: null,
      };
    }

    const user = this.repository.getUserById(stored.userId);
    if (!user) {
      this.recordDiagnosticEvent({
        area: 'auth',
        stage: 'magic_link',
        code: 'auth_magic_link_consume_missing_user',
        severity: 'error',
        summary: 'Magic-link consume failed because the user record was missing.',
        userId: stored.userId,
        payload: {
          email: stored.email,
        },
      });
      return {
        verified: false,
        userId: null,
        accessLevel: 'temporary',
        user: null,
        sessionToken: null,
        sessionExpiresAt: null,
      };
    }

    const updatedUser = this.verifyUserEmail(user, stored.email, {
      consumeTokenHash: stored.tokenHash,
    });
    const session = this.createSession(updatedUser, 'verified');
    this.recordDiagnosticEvent({
      area: 'auth',
      stage: 'magic_link',
      code: 'auth_magic_link_consumed',
      severity: 'info',
      summary: 'Magic-link consume completed and a verified session was created.',
      userId: updatedUser.id,
      payload: {
        email: updatedUser.email,
        sessionId: session.session.id,
        accessLevel: session.session.accessLevel,
      },
    });

    return {
      verified: true,
      userId: updatedUser.id,
      accessLevel: 'verified',
      user: updatedUser,
      sessionToken: session.rawToken,
      sessionExpiresAt: session.session.expiresAt,
    };
  }

  logout(rawSessionToken: string | null): LogoutResponse {
    if (rawSessionToken) {
      this.repository.deleteSessionByTokenHash(sha256(rawSessionToken));
    }
    return { ok: true };
  }

  extractPage(request: ExtractPageRequest): ExtractPageResponse {
    const extraction = extractPagePayload({
      sourceUrl: request.sourceUrl,
      pageContent: request.pageContent,
      ...(request.sourceIdentifier ? { sourceIdentifier: request.sourceIdentifier } : {}),
    });
    return {
      extraction,
      supported: isSourceSupported(extraction.sourceIdentifier),
      detectedSourceIdentifier: extraction.sourceIdentifier,
    };
  }

  private buildJobFromValidation(
    userId: string,
    jobId: string,
    extraction: ExtractPageResponse['extraction'],
    validation: CaptureJobResponse['validation'],
  ): Job | null {
    if (!validation.normalizedJobObject || validation.status === 'failed') {
      return null;
    }
    return {
      id: jobId,
      userId,
      sourceIdentifier: extraction.sourceIdentifier,
      sourceUrl: extraction.sourceUrl,
      rawCaptureContent: extraction.rawCaptureContent,
      normalizedJobObject: validation.normalizedJobObject,
      extractionConfidence: validation.extractionConfidence,
      captureSourceType: extraction.sourceIdentifier,
      extractionVersion: 'extraction-v1',
      jobExtractionState: validation.status === 'proceed' ? 'ready_for_evaluation' : 'review_required',
      createdAt: this.now(),
      updatedAt: this.now(),
    };
  }

  private async runExtractionPipeline(
    userId: string,
    jobId: string,
    extraction: ExtractPageResponse['extraction'],
    validation: ReturnType<typeof validateExtraction>,
  ): Promise<{
    extraction: ExtractPageResponse['extraction'];
    validation: ReturnType<typeof validateExtraction>;
    aiArtifactReferences: AiArtifactReference[];
    consensusSummary: AiConsensusSummary | null;
  }> {
    let nextExtraction = extraction;
    let nextValidation = validation;
    const artifactReferences: AiArtifactReference[] = [];
    let consensusSummary: AiConsensusSummary | null = null;
    this.recordDiagnosticEvent({
      area: 'extraction',
      stage: 'pipeline',
      code: 'extraction_pipeline_started',
      severity: 'info',
      summary: 'Extraction pipeline started.',
      userId,
      jobId,
      payload: {
        sourceIdentifier: extraction.sourceIdentifier,
        sourceUrl: extraction.sourceUrl,
        initialStatus: validation.status,
        initialExtractionConfidence: validation.extractionConfidence,
        missingFields: validation.missingFields,
        ambiguityFlags: extraction.ambiguityFlags,
        rawExtraction: this.hasEyeSession() ? extraction : undefined,
      },
    });

    const missingCriticalFields = nextValidation.missingFields
      .map((field) => String(field))
      .filter((field) => ['title', 'company', 'description'].includes(field));

    if (
      shouldRunAiExtractionFallback({
        sourceIdentifier: extraction.sourceIdentifier,
        validationStatus: nextValidation.status,
        ambiguityFlags: extraction.ambiguityFlags,
        missingCriticalFields,
      })
    ) {
      const fallback = await this.ai.extractJobFallback(userId, jobId, {
        sourceUrl: extraction.sourceUrl,
        sourceIdentifier: extraction.sourceIdentifier,
        rawCaptureContent: extraction.rawCaptureContent,
      });
      if (fallback) {
        const merged = mergeExtractionCandidates(
          nextExtraction.extractionCandidate,
          fallback.output.extractionCandidate,
          nextValidation.extractionConfidence,
        );
        nextExtraction = {
          ...nextExtraction,
          extractionCandidate: merged.candidate,
          ambiguityFlags: unique([
            ...nextExtraction.ambiguityFlags,
            ...fallback.output.ambiguityFlags,
            ...merged.conflicts.map((field) => `merge_conflict:${field}`),
          ]),
          extractionNotes: unique([
            ...nextExtraction.extractionNotes,
            ...fallback.output.extractionNotes,
            'ai_fallback_applied',
          ]),
          sourceOfTruthSummary: fallback.output.sourceOfTruthSummary ?? nextExtraction.sourceOfTruthSummary ?? null,
        };
        nextValidation = withMergedValidationMetadata(validateExtraction(nextExtraction), {
          fieldEvidence: [...merged.fieldEvidence, ...fallback.artifact.fieldEvidence],
          mergedFieldProvenance: merged.mergedFieldProvenance,
          coherenceAssessment: fallback.output.coherenceAssessment,
        });
        artifactReferences.push(fallback.artifactReference);
        consensusSummary = mergeConsensusSummaries(consensusSummary, fallback.artifact.consensus);
        this.recordDiagnosticEvent({
          area: 'extraction',
          stage: 'ai_fallback',
          code: 'extraction_ai_fallback_applied',
          severity: 'info',
          summary: 'AI extraction fallback updated the extracted job candidate.',
          userId,
          jobId,
          payload: {
            artifactId: fallback.artifact.id,
            promptVersion: fallback.artifact.promptVersion,
            overallConfidence: fallback.artifact.overallConfidence,
            conflicts: merged.conflicts,
            extractionCandidate: this.hasEyeSession() ? nextExtraction.extractionCandidate : undefined,
            validation: this.hasEyeSession() ? nextValidation : undefined,
          },
        });
      }

      const aiValidation = await this.ai.validateJobExtraction(userId, jobId, {
        sourceUrl: nextExtraction.sourceUrl,
        sourceIdentifier: nextExtraction.sourceIdentifier,
        rawCaptureContent: nextExtraction.rawCaptureContent,
        extractionCandidate: nextExtraction.extractionCandidate,
      });
      if (aiValidation) {
        nextExtraction = {
          ...nextExtraction,
          ambiguityFlags: unique([
            ...nextExtraction.ambiguityFlags,
            ...aiValidation.output.ambiguityFlags,
            ...(!aiValidation.output.coherenceAssessment.isSingleJob ? ['ai_coherence_review_required'] : []),
          ]),
          extractionNotes: unique([
            ...nextExtraction.extractionNotes,
            ...aiValidation.output.extractionNotes,
            'ai_validation_completed',
          ]),
          sourceOfTruthSummary: aiValidation.output.sourceOfTruthSummary ?? nextExtraction.sourceOfTruthSummary ?? null,
        };
        nextValidation = withMergedValidationMetadata(validateExtraction(nextExtraction), {
          fieldEvidence: [
            ...(nextValidation.fieldEvidence ?? []),
            ...aiValidation.artifact.fieldEvidence,
          ],
          ...(nextValidation.mergedFieldProvenance ? { mergedFieldProvenance: nextValidation.mergedFieldProvenance } : {}),
          coherenceAssessment: aiValidation.output.coherenceAssessment ?? null,
        });
        artifactReferences.push(aiValidation.artifactReference);
        consensusSummary = mergeConsensusSummaries(consensusSummary, aiValidation.artifact.consensus);
        this.recordDiagnosticEvent({
          area: 'extraction',
          stage: 'ai_validation',
          code: 'extraction_ai_validation_completed',
          severity: 'info',
          summary: 'AI extraction validation completed.',
          userId,
          jobId,
          payload: {
            artifactId: aiValidation.artifact.id,
            promptVersion: aiValidation.artifact.promptVersion,
            overallConfidence: aiValidation.artifact.overallConfidence,
            coherenceAssessment: aiValidation.output.coherenceAssessment,
            extractionCandidate: this.hasEyeSession() ? nextExtraction.extractionCandidate : undefined,
            validation: this.hasEyeSession() ? nextValidation : undefined,
          },
        });
      }
    }

    const shouldInferSignals =
      Boolean(nextExtraction.extractionCandidate.description?.trim()) &&
      (
        !nextExtraction.extractionCandidate.companySector ||
        !nextExtraction.extractionCandidate.companyType ||
        nextExtraction.extractionCandidate.keywords.length < 4
      );
    if (shouldInferSignals) {
      const inferredSignals = await this.ai.inferJobSignals(userId, jobId, {
        title: nextExtraction.extractionCandidate.title,
        description: nextExtraction.extractionCandidate.description ?? '',
        company: nextExtraction.extractionCandidate.company,
        companySector: nextExtraction.extractionCandidate.companySector,
        companyType: nextExtraction.extractionCandidate.companyType,
        keywords: nextExtraction.extractionCandidate.keywords,
      });
      if (inferredSignals) {
        const signalFieldEvidence = [...inferredSignals.artifact.fieldEvidence];
        const signalProvenance: Record<string, 'deterministic' | 'ai' | 'merged' | 'user_corrected'> = {
          ...(nextValidation.mergedFieldProvenance ?? {}),
        };
        const nextCandidate = {
          ...nextExtraction.extractionCandidate,
          companySector: nextExtraction.extractionCandidate.companySector ?? inferredSignals.output.companySector,
          companyType: nextExtraction.extractionCandidate.companyType ?? inferredSignals.output.companyType,
          keywords: unique([...nextExtraction.extractionCandidate.keywords, ...inferredSignals.output.salientKeywords]),
        };

        if (!nextExtraction.extractionCandidate.companySector && inferredSignals.output.companySector) {
          signalProvenance['companySector'] = 'ai';
        }
        if (!nextExtraction.extractionCandidate.companyType && inferredSignals.output.companyType) {
          signalProvenance['companyType'] = 'ai';
        }
        if (nextCandidate.keywords.length !== nextExtraction.extractionCandidate.keywords.length) {
          signalProvenance['keywords'] = 'merged';
        }

        nextExtraction = {
          ...nextExtraction,
          extractionCandidate: nextCandidate,
          extractionNotes: unique([...nextExtraction.extractionNotes, 'ai_signal_inference_applied']),
        };
        nextValidation = withMergedValidationMetadata(validateExtraction(nextExtraction), {
          fieldEvidence: [
            ...(nextValidation.fieldEvidence ?? []),
            ...signalFieldEvidence,
          ],
          mergedFieldProvenance: signalProvenance,
          coherenceAssessment: nextValidation.coherenceAssessment ?? null,
        });
        artifactReferences.push(inferredSignals.artifactReference);
        consensusSummary = mergeConsensusSummaries(consensusSummary, inferredSignals.artifact.consensus);
        this.recordDiagnosticEvent({
          area: 'extraction',
          stage: 'signal_inference',
          code: 'extraction_ai_signal_inference_applied',
          severity: 'info',
          summary: 'AI signal inference enriched the extracted job data.',
          userId,
          jobId,
          payload: {
            artifactId: inferredSignals.artifact.id,
            promptVersion: inferredSignals.artifact.promptVersion,
            overallConfidence: inferredSignals.artifact.overallConfidence,
            addedSector: nextExtraction.extractionCandidate.companySector,
            addedCompanyType: nextExtraction.extractionCandidate.companyType,
            keywords: this.hasEyeSession() ? nextExtraction.extractionCandidate.keywords : undefined,
          },
        });
      }
    }

    this.recordDiagnosticEvent({
      area: 'extraction',
      stage: 'pipeline',
      code: 'extraction_pipeline_completed',
      severity: nextValidation.status === 'failed' ? 'error' : nextValidation.status === 'review_required' ? 'warning' : 'info',
      summary: nextValidation.status === 'proceed'
        ? 'Extraction pipeline completed with evaluable job data.'
        : nextValidation.status === 'review_required'
          ? 'Extraction pipeline completed but the job still requires review.'
          : 'Extraction pipeline failed to produce a usable job.',
      userId,
      jobId,
      payload: {
        sourceIdentifier: nextExtraction.sourceIdentifier,
        validationStatus: nextValidation.status,
        extractionConfidence: nextValidation.extractionConfidence,
        reviewReasons: nextValidation.reasons,
        fieldEvidence: this.hasEyeSession() ? nextValidation.fieldEvidence : undefined,
        mergedFieldProvenance: this.hasEyeSession() ? nextValidation.mergedFieldProvenance : undefined,
        extractionOutput: this.hasEyeSession() ? nextExtraction : undefined,
        consensusSummary,
      },
    });

    return {
      extraction: nextExtraction,
      validation: nextValidation,
      aiArtifactReferences: [...new Map(artifactReferences.map((reference) => [reference.id, reference])).values()],
      consensusSummary,
    };
  }

  private async captureExtraction(
    userId: string,
    extraction: ExtractPageResponse['extraction'],
    captureMethod: 'page' | 'manual' | 'pre_extracted',
  ): Promise<CaptureJobResponse> {
    const exactSourceUrlKey = normalizeUrl(extraction.sourceUrl);
    if (exactSourceUrlKey) {
      const existingJob = this.repository.findJobByExactSourceUrl(userId, exactSourceUrlKey);
      if (existingJob) {
        const detail = this.repository.getTrackerDetailByJobId(existingJob.id);
        const existingValidation = detail.validation ?? validateExtraction(extraction);
        this.recordDiagnosticEvent({
          area: 'capture',
          stage: 'dedupe',
          code: 'capture_exact_source_reused',
          severity: existingValidation.status === 'proceed' ? 'info' : 'warning',
          summary: 'Capture reused an existing tracker item because the source URL already existed.',
          userId,
          jobId: existingJob.id,
          trackerItemId: detail.trackerItem?.id ?? null,
          payload: {
            sourceIdentifier: extraction.sourceIdentifier,
            sourceUrl: extraction.sourceUrl,
            captureMethod,
            validationStatus: existingValidation.status,
          },
        });
        this.recordEvent(existingValidation.status === 'proceed' ? 'job_capture_succeeded' : 'job_review_required', userId, {
          userId,
          jobId: existingJob.id,
          trackerItemId: detail.trackerItem?.id,
          sourceType: extraction.sourceIdentifier,
          sourceDomain: sourceDomainFromUrl(extraction.sourceUrl),
          captureMethod,
          extractionConfidenceBand: toExtractionConfidenceBand(existingValidation.extractionConfidence),
          reviewRequiredFlag: existingValidation.status !== 'proceed',
          duplicateReuse: true,
        });
        return {
          validation: existingValidation,
          job: existingJob,
          trackerItem: detail.trackerItem,
        };
      }
    }

    const jobId = createId('job');
    const enrichedExtraction = await this.runExtractionPipeline(userId, jobId, extraction, validateExtraction(extraction));
    const validation = enrichedExtraction.validation;
    const job = this.buildJobFromValidation(userId, jobId, enrichedExtraction.extraction, validation);
    if (!job) {
      this.recordDiagnosticEvent({
        area: 'capture',
        stage: 'result',
        code: 'capture_failed_validation',
        severity: 'error',
        summary: 'Capture failed because the extracted job could not be normalized into a usable record.',
        userId,
        jobId,
        payload: {
          sourceIdentifier: extraction.sourceIdentifier,
          sourceUrl: extraction.sourceUrl,
          captureMethod,
          validationStatus: validation.status,
          reviewReasons: validation.reasons,
        },
      });
      this.recordEvent('job_capture_failed', userId, {
        userId,
        sourceType: extraction.sourceIdentifier,
        sourceDomain: sourceDomainFromUrl(extraction.sourceUrl),
        captureMethod,
        extractionConfidenceBand: toExtractionConfidenceBand(validation.extractionConfidence),
        reviewRequiredFlag: validation.status !== 'proceed',
      });
      return {
        validation,
        job: null,
        trackerItem: null,
      };
    }

    const probableDuplicateKey = buildProbableDuplicateKey(job);
    const probableDuplicateJobIds = probableDuplicateKey
      ? filterProbableDuplicateJobIds(
          this.repository.findProbableDuplicateJobs(userId, probableDuplicateKey).map((candidate) => candidate.id),
          null,
        )
      : [];
    const trackerItem = {
      ...createTrackerItem(job, null, this.clock),
      probableDuplicateJobIds,
    };
    const extractionRecord: JobExtractionRecord = {
      id: createId('jex'),
      userId,
      jobId: job.id,
      extractionVersion: job.extractionVersion,
      reviewCount: 0,
      history: [
        {
          timestamp: this.now(),
          action: 'captured',
          status: validation.status,
          extractionConfidence: validation.extractionConfidence,
          note: `Initial ${captureMethod} capture.`,
          source:
            captureMethod === 'manual'
              ? 'manual'
              : enrichedExtraction.aiArtifactReferences.length > 0
                ? 'merged'
                : 'deterministic',
        },
      ],
      extraction: enrichedExtraction.extraction,
      validation,
      aiArtifactReferences: enrichedExtraction.aiArtifactReferences,
      consensusSummary: enrichedExtraction.consensusSummary,
      createdAt: this.now(),
      updatedAt: this.now(),
    };

    this.repository.runInTransaction(() => {
      this.repository.saveJob({
        job,
        sourceUrlKey: exactSourceUrlKey,
        probableDuplicateKey,
      });
      this.repository.saveJobExtraction(extractionRecord);
      this.repository.saveTrackerItem(trackerItem);
    });

    this.recordDiagnosticEvent({
      area: 'capture',
      stage: 'result',
      code: validation.status === 'proceed' ? 'capture_succeeded' : 'capture_review_required',
      severity: validation.status === 'proceed' ? 'info' : 'warning',
      summary: validation.status === 'proceed'
        ? 'Capture produced a tracker item ready for evaluation.'
        : 'Capture produced a tracker item that still requires manual review.',
      userId,
      jobId: job.id,
      trackerItemId: trackerItem.id,
      payload: {
        sourceIdentifier: extraction.sourceIdentifier,
        sourceUrl: extraction.sourceUrl,
        captureMethod,
        validationStatus: validation.status,
        extractionConfidence: validation.extractionConfidence,
        probableDuplicateJobIds,
        normalizedJobObject: this.hasEyeSession() ? job.normalizedJobObject : undefined,
      },
    });

    this.recordEvent(validation.status === 'proceed' ? 'job_capture_succeeded' : 'job_review_required', userId, {
      userId,
      jobId: job.id,
      trackerItemId: trackerItem.id,
      sourceType: extraction.sourceIdentifier,
      sourceDomain: sourceDomainFromUrl(extraction.sourceUrl),
      captureMethod,
      extractionConfidenceBand: toExtractionConfidenceBand(validation.extractionConfidence),
      reviewRequiredFlag: validation.status !== 'proceed',
      probableDuplicateCount: probableDuplicateJobIds.length,
    });

    return {
      validation,
      job,
      trackerItem,
    };
  }

  async capturePage(userId: string, request: CapturePageRequest): Promise<CapturePageResponse> {
    const extracted = this.extractPage(request);
    this.recordDiagnosticEvent({
      area: 'capture',
      stage: 'start',
      code: 'capture_page_started',
      severity: 'info',
      summary: 'Page capture started.',
      userId,
      payload: {
        sourceUrl: request.sourceUrl,
        detectedSourceIdentifier: extracted.detectedSourceIdentifier,
        supported: extracted.supported,
        rawPageContentLength: this.hasEyeSession() ? request.pageContent.length : undefined,
      },
    });
    this.recordEvent('job_capture_started', userId, {
      userId,
      sourceType: extracted.extraction.sourceIdentifier,
      sourceDomain: sourceDomainFromUrl(extracted.extraction.sourceUrl),
      captureMethod: 'page',
    });
    const captured = await this.captureExtraction(userId, extracted.extraction, 'page');
    return {
      ...captured,
      extraction: extracted.extraction,
      supported: extracted.supported,
      detectedSourceIdentifier: extracted.detectedSourceIdentifier,
    };
  }

  async captureExtractedJob(userId: string, extraction: ExtractPageResponse['extraction']): Promise<CaptureJobResponse> {
    this.recordEvent('job_capture_started', userId, {
      userId,
      sourceType: extraction.sourceIdentifier,
      sourceDomain: sourceDomainFromUrl(extraction.sourceUrl),
      captureMethod: 'pre_extracted',
    });
    return this.captureExtraction(userId, extraction, 'pre_extracted');
  }

  async captureManual(userId: string, request: CaptureManualJobRequest): Promise<CaptureJobResponse> {
    const extraction = {
      sourceIdentifier: request.sourceIdentifier ?? 'manual',
      sourceUrl: request.sourceUrl ?? `manual://${createId('job')}`,
      rawCaptureContent: request.description ?? '',
      extractionCandidate: {
        title: request.title,
        company: request.company,
        location: request.location,
        workSetup: request.workSetup,
        employmentType: request.employmentType,
        description: request.description,
        recruiterOrPosterSignal: request.recruiterOrPosterSignal,
        companySector: request.companySector,
        companyType: request.companyType,
        keywords: unique(request.keywords),
      },
      sourceConfidenceHints: [],
      ambiguityFlags: [],
      extractionNotes: ['manual_capture'],
    } satisfies ExtractPageResponse['extraction'];

    this.recordEvent('job_capture_started', userId, {
      userId,
      sourceType: extraction.sourceIdentifier,
      sourceDomain: sourceDomainFromUrl(extraction.sourceUrl),
      captureMethod: 'manual',
    });
    this.recordEvent('job_manual_paste_used', userId, {
      userId,
      sourceType: extraction.sourceIdentifier,
      sourceDomain: sourceDomainFromUrl(extraction.sourceUrl),
      captureMethod: 'manual',
    });
    this.recordDiagnosticEvent({
      area: 'capture',
      stage: 'start',
      code: 'capture_manual_started',
      severity: 'info',
      summary: 'Manual capture started.',
      userId,
      payload: {
        sourceUrl: extraction.sourceUrl,
        sourceIdentifier: extraction.sourceIdentifier,
        extractionCandidate: this.hasEyeSession() ? extraction.extractionCandidate : undefined,
      },
    });

    return this.captureExtraction(userId, extraction, 'manual');
  }

  getJobReview(userId: string, jobId: string): JobReviewResponse {
    const detail = this.repository.getTrackerDetailByJobId(jobId);
    if (detail.job?.userId !== userId) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    return detail;
  }

  updateJobReview(userId: string, jobId: string, input: UpdateJobReviewRequest): JobReviewResponse {
    const detail = this.repository.getTrackerDetailByJobId(jobId);
    const job = detail.job;
    if (!job || job.userId !== userId) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    const extractionRecord = this.repository.getJobExtractionByJobId(jobId);
    if (!extractionRecord) {
      throw new Error(`Job extraction for ${jobId} was not found.`);
    }

    const updatedExtraction = {
      ...extractionRecord.extraction,
      extractionCandidate: {
        ...extractionRecord.extraction.extractionCandidate,
        title: input.title,
        company: input.company,
        location: input.location,
        workSetup: input.workSetup,
        employmentType: input.employmentType,
        description: input.description,
        recruiterOrPosterSignal: input.recruiterOrPosterSignal,
        companySector: input.companySector,
        companyType: input.companyType,
        keywords: unique(input.keywords),
      },
      ambiguityFlags: [],
      sourceConfidenceHints: unique([...extractionRecord.extraction.sourceConfidenceHints, 'manual_review_confirmed']),
      extractionNotes: unique([...extractionRecord.extraction.extractionNotes, 'manual_review_update']),
    };
    const manualExtractionMetadata = buildManualExtractionMetadata(
      extractionRecord.extraction.extractionCandidate,
      updatedExtraction.extractionCandidate,
    );
    updatedExtraction.sourceOfTruthSummary = manualExtractionMetadata.changedFields.length > 0
      ? `Manual review corrected: ${manualExtractionMetadata.changedFields.join(', ')}.`
      : 'Manual review confirmed the extracted job facts without changing field values.';

    const baseValidation = validateExtraction(updatedExtraction);
    const validation = {
      ...baseValidation,
      fieldEvidence: [
        ...(baseValidation.fieldEvidence ?? []).filter((entry) => !manualExtractionMetadata.changedFields.includes(entry.field)),
        ...manualExtractionMetadata.fieldEvidence,
      ],
      mergedFieldProvenance: {
        ...(baseValidation.mergedFieldProvenance ?? {}),
        ...manualExtractionMetadata.mergedFieldProvenance,
      },
    };
    const probableDuplicateKey = buildProbableDuplicateKey({
      ...job,
      normalizedJobObject: validation.normalizedJobObject ?? job.normalizedJobObject,
    });
    const probableDuplicateJobIds = probableDuplicateKey
      ? filterProbableDuplicateJobIds(
          this.repository.findProbableDuplicateJobs(userId, probableDuplicateKey, jobId).map((candidate) => candidate.id),
          detail.trackerItem,
        )
      : [];
    const updatedJob: Job = {
      ...job,
      normalizedJobObject: validation.normalizedJobObject ?? job.normalizedJobObject,
      extractionConfidence: validation.extractionConfidence,
      jobExtractionState:
        validation.status === 'proceed'
          ? 'ready_for_evaluation'
          : validation.status === 'failed'
            ? 'failed'
            : 'review_required',
      updatedAt: this.now(),
    };
    const updatedExtractionRecord: JobExtractionRecord = {
      ...extractionRecord,
      extractionVersion: updatedJob.extractionVersion,
      reviewCount: extractionRecord.reviewCount + 1,
      history: [
        ...extractionRecord.history,
        {
          timestamp: this.now(),
          action: validation.status === 'proceed' ? 'review_confirmed' : 'review_edited',
          status: validation.status,
          extractionConfidence: validation.extractionConfidence,
          note:
            `${manualExtractionMetadata.changedFields.length > 0
              ? `Manual review changed: ${manualExtractionMetadata.changedFields.join(', ')}.`
              : 'Manual review confirmed extracted fields.'}${
                input.reevaluateAfterSave ? ' Reevaluation requested.' : ''
              }`,
          source: 'manual',
        },
      ],
      extraction: updatedExtraction,
      validation,
      aiArtifactReferences: extractionRecord.aiArtifactReferences,
      consensusSummary: extractionRecord.consensusSummary,
      updatedAt: this.now(),
    };
    const updatedTracker = detail.trackerItem
      ? {
          ...detail.trackerItem,
          probableDuplicateJobIds,
          updatedAt: this.now(),
        }
      : createTrackerItem(updatedJob, detail.evaluation, this.clock);
    const trackerDiff = detail.trackerItem
      ? summarizeObjectDiff(
          detail.trackerItem as unknown as Record<string, unknown>,
          updatedTracker as unknown as Record<string, unknown>,
        )
      : ['created'];

    this.repository.runInTransaction(() => {
      this.repository.saveJob({
        job: updatedJob,
        sourceUrlKey: normalizeUrl(updatedJob.sourceUrl),
        probableDuplicateKey,
      });
      this.repository.saveJobExtraction(updatedExtractionRecord);
      this.repository.saveTrackerItem(updatedTracker);
    });

    this.recordDiagnosticEvent({
      area: 'tracker',
      stage: 'review_save',
      code: validation.status === 'proceed' ? 'job_review_confirmed' : 'job_review_saved',
      severity: validation.status === 'proceed' ? 'info' : 'warning',
      summary: validation.status === 'proceed'
        ? 'Manual job review produced evaluation-ready job data.'
        : 'Manual job review saved changes but the job still requires review.',
      userId,
      jobId,
      trackerItemId: updatedTracker.id,
      payload: {
        changedExtractionFields: manualExtractionMetadata.changedFields,
        extractionDiff: summarizeObjectDiff(
          extractionRecord.extraction.extractionCandidate as unknown as Record<string, unknown>,
          updatedExtraction.extractionCandidate as unknown as Record<string, unknown>,
        ),
        trackerDiff,
        reviewRequired: validation.status !== 'proceed',
        previousExtractionCandidate: this.hasEyeSession() ? extractionRecord.extraction.extractionCandidate : undefined,
        nextExtractionCandidate: this.hasEyeSession() ? updatedExtraction.extractionCandidate : undefined,
        normalizedJobObject: this.hasEyeSession() ? updatedJob.normalizedJobObject : undefined,
        validation: this.hasEyeSession() ? validation : undefined,
      },
    });

    this.recordEvent('job_review_edited', userId, {
      userId,
      jobId,
      extractionConfidenceBand: toExtractionConfidenceBand(validation.extractionConfidence),
      reviewRequiredFlag: validation.status !== 'proceed',
    });
    if (validation.status === 'proceed') {
      this.recordEvent('job_review_confirmed', userId, {
        userId,
        jobId,
        extractionConfidenceBand: toExtractionConfidenceBand(validation.extractionConfidence),
        reviewRequiredFlag: false,
      });
    }
    if (input.reevaluateAfterSave && validation.status === 'proceed') {
      this.evaluateJobInternal(userId, jobId, true);
    }
    return this.repository.getTrackerDetailByJobId(jobId);
  }

  async reprocessJob(userId: string, jobId: string, reevaluateAfterReprocess = false): Promise<JobReviewResponse> {
    const detail = this.repository.getTrackerDetailByJobId(jobId);
    const job = detail.job;
    if (!job || job.userId !== userId) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    const extractionRecord = this.repository.getJobExtractionByJobId(jobId);
    if (!extractionRecord) {
      throw new Error(`Job extraction for ${jobId} was not found.`);
    }

    const refreshedExtraction =
      job.sourceIdentifier !== 'manual' && job.sourceUrl && job.rawCaptureContent
        ? extractPagePayload({
            sourceUrl: job.sourceUrl,
            pageContent: job.rawCaptureContent,
            sourceIdentifier: job.sourceIdentifier,
          })
        : {
            ...extractionRecord.extraction,
            extractionNotes: unique([...extractionRecord.extraction.extractionNotes, 'reprocessed_from_stored_capture']),
          };

    const enrichedExtraction = await this.runExtractionPipeline(userId, jobId, refreshedExtraction, validateExtraction(refreshedExtraction));
    const validation = enrichedExtraction.validation;
    const probableDuplicateKey = buildProbableDuplicateKey({
      ...job,
      normalizedJobObject: validation.normalizedJobObject ?? job.normalizedJobObject,
    });
    const probableDuplicateJobIds = probableDuplicateKey
      ? filterProbableDuplicateJobIds(
          this.repository.findProbableDuplicateJobs(userId, probableDuplicateKey, jobId).map((candidate) => candidate.id),
          detail.trackerItem,
        )
      : [];
    const updatedJob: Job = {
      ...job,
      normalizedJobObject: validation.normalizedJobObject ?? job.normalizedJobObject,
      extractionConfidence: validation.extractionConfidence,
      jobExtractionState:
        validation.status === 'proceed'
          ? 'ready_for_evaluation'
          : validation.status === 'failed'
            ? 'failed'
            : 'review_required',
      updatedAt: this.now(),
    };
    const updatedExtractionRecord: JobExtractionRecord = {
      ...extractionRecord,
      extractionVersion: updatedJob.extractionVersion,
      history: [
        ...extractionRecord.history,
        {
          timestamp: this.now(),
          action: 'reextracted',
          status: validation.status,
          extractionConfidence: validation.extractionConfidence,
          note: reevaluateAfterReprocess ? 'Reprocessed from stored capture and reevaluation requested.' : 'Reprocessed from stored capture.',
          source: enrichedExtraction.aiArtifactReferences.length > 0 ? 'merged' : 'deterministic',
        },
      ],
      extraction: enrichedExtraction.extraction,
      validation,
      aiArtifactReferences: [
        ...new Map(
          [...extractionRecord.aiArtifactReferences, ...enrichedExtraction.aiArtifactReferences].map((reference) => [reference.id, reference]),
        ).values(),
      ],
      consensusSummary: mergeConsensusSummaries(extractionRecord.consensusSummary, enrichedExtraction.consensusSummary),
      updatedAt: this.now(),
    };
    const updatedTracker = detail.trackerItem
      ? {
          ...detail.trackerItem,
          probableDuplicateJobIds,
          updatedAt: this.now(),
        }
      : createTrackerItem(updatedJob, detail.evaluation, this.clock);
    const trackerDiff = detail.trackerItem
      ? summarizeObjectDiff(
          detail.trackerItem as unknown as Record<string, unknown>,
          updatedTracker as unknown as Record<string, unknown>,
        )
      : ['created'];

    this.repository.runInTransaction(() => {
      this.repository.saveJob({
        job: updatedJob,
        sourceUrlKey: normalizeUrl(updatedJob.sourceUrl),
        probableDuplicateKey,
      });
      this.repository.saveJobExtraction(updatedExtractionRecord);
      this.repository.saveTrackerItem(updatedTracker);
    });

    this.recordDiagnosticEvent({
      area: 'capture',
      stage: 'reprocess',
      code: 'capture_reprocessed',
      severity: validation.status === 'failed' ? 'error' : validation.status === 'review_required' ? 'warning' : 'info',
      summary: validation.status === 'proceed'
        ? 'Stored capture was reprocessed successfully.'
        : validation.status === 'review_required'
          ? 'Stored capture was reprocessed but still requires review.'
          : 'Stored capture reprocessing failed.',
      userId,
      jobId,
      trackerItemId: updatedTracker.id,
      payload: {
        reevaluateAfterReprocess,
        extractionDiff: summarizeObjectDiff(
          extractionRecord.extraction.extractionCandidate as unknown as Record<string, unknown>,
          enrichedExtraction.extraction.extractionCandidate as unknown as Record<string, unknown>,
        ),
        trackerDiff,
        validationStatus: validation.status,
        reviewReasons: validation.reasons,
        previousExtractionCandidate: this.hasEyeSession() ? extractionRecord.extraction.extractionCandidate : undefined,
        nextExtractionCandidate: this.hasEyeSession() ? enrichedExtraction.extraction.extractionCandidate : undefined,
        normalizedJobObject: this.hasEyeSession() ? updatedJob.normalizedJobObject : undefined,
        extractionOutput: this.hasEyeSession() ? enrichedExtraction.extraction : undefined,
      },
    });

    this.recordEvent(validation.status === 'proceed' ? 'job_capture_succeeded' : 'job_review_required', userId, {
      userId,
      jobId,
      trackerItemId: updatedTracker.id,
      sourceType: updatedJob.sourceIdentifier,
      sourceDomain: sourceDomainFromUrl(updatedJob.sourceUrl),
      captureMethod: 'pre_extracted',
      extractionConfidenceBand: toExtractionConfidenceBand(validation.extractionConfidence),
      reviewRequiredFlag: validation.status !== 'proceed',
      reprocessed: true,
    });

    if (reevaluateAfterReprocess && validation.status === 'proceed') {
      await this.evaluateJobInternal(userId, jobId, true);
    }

    return this.repository.getTrackerDetailByJobId(jobId);
  }

  async evaluateJob(userId: string, jobId: string): Promise<EvaluateJobResponse> {
    return this.evaluateJobInternal(userId, jobId, false);
  }

  listTracker(userId: string): TrackerListResponse {
    const cvNameById = new Map(
      this.repository.listCvProfilesByUser(userId).map((profile) => [profile.cvId, profile.cvName]),
    );
    const items = this.repository
      .listTrackerDetailsByUser(userId)
      .filter((detail) => detail.trackerItem && detail.job)
      .map((detail) => ({
        trackerItem: detail.trackerItem!,
        job: detail.job!,
        evaluation: detail.evaluation,
        recommendedCvName:
          (detail.evaluation?.recommendedCvId
            ? cvNameById.get(detail.evaluation.recommendedCvId) ?? null
            : null)
          ?? (detail.trackerItem?.recommendationSnapshot?.recommendedCvId
            ? cvNameById.get(detail.trackerItem.recommendationSnapshot.recommendedCvId) ?? null
            : null),
        selectedCvName:
          detail.trackerItem?.userSelectedCvId
            ? cvNameById.get(detail.trackerItem.userSelectedCvId) ?? null
            : null,
      }));
    return { items };
  }

  getTrackerDetail(userId: string, jobId: string): TrackerDetailResponse {
    const detail = this.repository.getTrackerDetailByJobId(jobId);
    if (detail.job?.userId !== userId) {
      return {
        trackerItem: null,
        job: null,
        evaluation: null,
        validation: null,
        extractionMeta: null,
        historicalEvaluations: [],
        availableCvs: [],
        probableDuplicates: [],
      };
    }
    return detail;
  }

  getOpsSummary(userId: string): OpsSummaryResponse {
    const user = this.repository.getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} was not found.`);
    }

    const trackerDetails = this.repository.listTrackerDetailsByUser(userId);
    const trackerStatusCounts = new Map<TrackerStatus, number>(trackerStatusOrder.map((status) => [status, 0]));
    for (const detail of trackerDetails) {
      const status = detail.trackerItem?.currentStatus;
      if (!status) {
        continue;
      }
      trackerStatusCounts.set(status, (trackerStatusCounts.get(status) ?? 0) + 1);
    }

    const analyticsEvents = this.repository.listAnalyticsEvents(userId);
    const analyticsCounts = new Map<AnalyticsEventName, number>();
    for (const event of analyticsEvents) {
      if (!analyticsEventNameSet.has(event.name)) {
        continue;
      }
      const eventName = event.name as AnalyticsEventName;
      analyticsCounts.set(eventName, (analyticsCounts.get(eventName) ?? 0) + 1);
    }

    const latestOutbox = user.email ? this.repository.getLatestEmailOutbox(user.email) : null;
    const trackerDetailsByUpdated = [...trackerDetails].sort((left, right) => {
      const leftUpdatedAt = left.trackerItem?.updatedAt ?? left.job?.updatedAt ?? '';
      const rightUpdatedAt = right.trackerItem?.updatedAt ?? right.job?.updatedAt ?? '';
      return rightUpdatedAt.localeCompare(leftUpdatedAt);
    });
    const reviewQueue = trackerDetailsByUpdated
      .filter((detail) => detail.job && detail.validation?.status && detail.validation.status !== 'proceed')
      .map((detail) => ({
        jobId: detail.job!.id,
        title: detail.job!.normalizedJobObject.title,
        company: detail.job!.normalizedJobObject.company,
        currentStatus: detail.trackerItem?.currentStatus ?? null,
        updatedAt: detail.trackerItem?.updatedAt ?? detail.job!.updatedAt,
        reviewReasons: detail.validation?.reasons ?? [],
      }))
      .slice(0, 8);
    const duplicateQueue = trackerDetailsByUpdated
      .filter((detail) => detail.job && (detail.trackerItem?.probableDuplicateJobIds.length ?? 0) > 0)
      .map((detail) => ({
        jobId: detail.job!.id,
        title: detail.job!.normalizedJobObject.title,
        company: detail.job!.normalizedJobObject.company,
        duplicateCount: detail.trackerItem?.probableDuplicateJobIds.length ?? 0,
        updatedAt: detail.trackerItem?.updatedAt ?? detail.job!.updatedAt,
      }))
      .slice(0, 8);
    const overrideActiveItems = trackerDetailsByUpdated
      .filter((detail) => detail.job && detail.trackerItem)
      .filter((detail) => detail.trackerItem!.recommendedCvDecision === 'overridden' || detail.trackerItem!.verdictDecision === 'overridden')
      .map((detail) => ({
        jobId: detail.job!.id,
        title: detail.job!.normalizedJobObject.title,
        company: detail.job!.normalizedJobObject.company,
        recommendedCvDecision: detail.trackerItem!.recommendedCvDecision,
        verdictDecision: detail.trackerItem!.verdictDecision,
        updatedAt: detail.trackerItem!.updatedAt,
      }))
      .slice(0, 8);

    return {
      summary: {
        user: {
          id: user.id,
          email: user.email,
          accountStatus: user.accountStatus,
          emailVerificationStatus: user.emailVerificationStatus,
        },
        tracker: {
          totalItems: trackerDetails.length,
          reviewRequiredItems: trackerDetails.filter((detail) => detail.validation?.status && detail.validation.status !== 'proceed').length,
          duplicateCandidateItems: trackerDetails.filter((detail) => (detail.trackerItem?.probableDuplicateJobIds.length ?? 0) > 0).length,
          itemsWithActiveEvaluation: trackerDetails.filter((detail) => Boolean(detail.evaluation)).length,
          byStatus: trackerStatusOrder.map((status) => ({
            status,
            count: trackerStatusCounts.get(status) ?? 0,
          })),
          reviewQueue,
          duplicateQueue,
          overrideActiveItems,
        },
        analytics: {
          totalEvents: analyticsEvents.length,
          byName: [...analyticsCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([name, count]) => ({ name, count })),
          missingKeyEvents: opsKeyAnalyticsEvents.filter((name) => !analyticsCounts.has(name)),
        },
        email: {
          currentAddress: user.email,
          latestDeliveryStatus: latestOutbox?.deliveryStatus ?? null,
          latestDeliveryProvider: latestOutbox?.deliveryProvider ?? null,
          latestCreatedAt: latestOutbox?.createdAt ?? null,
          latestAttemptAt: latestOutbox?.lastAttemptAt ?? null,
        },
      },
    };
  }

  getRuntimeReadiness(): RuntimeReadinessResponse {
    const aiFlags = this.ai.getFlags();
    const aiProviderConfigured = this.ai.isProviderConfigured();
    const warnings: string[] = [];

    if (Object.values(aiFlags).some(Boolean) && !aiProviderConfigured) {
      warnings.push('One or more AI features are enabled, but no OpenAI provider is configured.');
    }

    return {
      checks: {
        databaseReady: this.repository.ping(),
        emailDeliveryConfigured: this.emailDelivery.isConfigured(),
        aiProviderConfigured,
      },
      ai: {
        configuredFlags: aiFlags,
        activeFeatures: {
          aiSetupSuggestions: this.ai.isFeatureEnabled('aiSetupSuggestions'),
          aiExtractionFallback: this.ai.isFeatureEnabled('aiExtractionFallback'),
          aiSignalInference: this.ai.isFeatureEnabled('aiSignalInference'),
          aiConsensus: this.ai.isFeatureEnabled('aiConsensus'),
        },
      },
      warnings,
      timestamp: this.now(),
    };
  }

  updateTrackerStatus(userId: string, jobId: string, status: TrackerStatus): TrackerDetailResponse {
    const tracker = this.repository.getTrackerItemByJobId(jobId);
    if (!tracker || tracker.userId !== userId) {
      throw new Error(`Tracker item for ${jobId} was not found.`);
    }
    const activeEvaluation = tracker.activeEvaluationId
      ? this.repository.getEvaluationById(tracker.activeEvaluationId)
      : this.repository.getActiveEvaluationByJobId(jobId);
    const updated = patchTrackerStatus(tracker, status, activeEvaluation, this.clock);
    this.repository.saveTrackerItem(updated);
    this.recordDiagnosticEvent({
      area: 'tracker',
      stage: 'status',
      code: 'tracker_status_updated',
      severity: 'info',
      summary: 'Tracker status was updated.',
      userId,
      jobId,
      trackerItemId: updated.id,
      payload: {
        previousStatus: tracker.currentStatus,
        nextStatus: updated.currentStatus,
        trackerDiff: summarizeObjectDiff(
          tracker as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
        before: this.hasEyeSession() ? tracker : undefined,
        after: this.hasEyeSession() ? updated : undefined,
      },
    });
    this.recordEvent('status_changed', userId, { userId, jobId, status });
    return this.getTrackerDetail(userId, jobId);
  }

  updateTrackerRecommendationDecision(
    userId: string,
    jobId: string,
    input: UpdateTrackerRecommendationRequest,
  ): UpdateTrackerRecommendationResponse {
    const tracker = this.repository.getTrackerItemByJobId(jobId);
    if (!tracker || tracker.userId !== userId) {
      throw new Error(`Tracker item for ${jobId} was not found.`);
    }
    const recommendedCvId = tracker.recommendationSnapshot?.recommendedCvId ?? null;
    const activeEvaluation = tracker.activeEvaluationId
      ? this.repository.getEvaluationById(tracker.activeEvaluationId)
      : this.repository.getActiveEvaluationByJobId(jobId);

    let decision = input.decision;
    let selectedCvId: string | null = null;

    if (decision === 'pending') {
      selectedCvId = null;
    } else if (!recommendedCvId) {
      throw new Error('No recommended CV exists for this tracker item.');
    } else if (decision === 'accepted') {
      selectedCvId = recommendedCvId;
    } else {
      if (!input.selectedCvId) {
        throw new Error('selectedCvId is required when overriding the recommended CV.');
      }
      const cvBelongsToUser = this.repository.listCvProfilesByUser(userId).some((profile) => profile.cvId === input.selectedCvId);
      if (!cvBelongsToUser) {
        throw new Error(`CV ${input.selectedCvId} does not belong to the current user.`);
      }
      if (input.selectedCvId === recommendedCvId) {
        decision = 'accepted';
        selectedCvId = recommendedCvId;
      } else {
        selectedCvId = input.selectedCvId;
      }
    }

    const updated = patchTrackerRecommendationDecision(tracker, decision, selectedCvId, activeEvaluation, this.clock);
    this.repository.saveTrackerItem(updated);
    this.recordDiagnosticEvent({
      area: 'tracker',
      stage: 'recommendation',
      code: decision === 'pending' ? 'tracker_recommendation_reset' : 'tracker_recommendation_updated',
      severity: 'info',
      summary: decision === 'pending'
        ? 'Tracker recommendation decision was reset to the latest system value.'
        : 'Tracker recommendation decision was updated.',
      userId,
      jobId,
      trackerItemId: updated.id,
      payload: {
        previousDecision: tracker.recommendedCvDecision,
        nextDecision: updated.recommendedCvDecision,
        previousSelectedCvId: tracker.userSelectedCvId,
        nextSelectedCvId: updated.userSelectedCvId,
        systemRecommendedCvId: recommendedCvId,
        trackerDiff: summarizeObjectDiff(
          tracker as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
        before: this.hasEyeSession() ? tracker : undefined,
        after: this.hasEyeSession() ? updated : undefined,
      },
    });
    if (decision === 'accepted' || decision === 'overridden') {
      this.recordEvent(decision === 'accepted' ? 'recommended_cv_accepted' : 'recommended_cv_overridden', userId, {
        userId,
        jobId,
        trackerItemId: updated.id,
        recommendedCvId,
        ...(selectedCvId ? { cvId: selectedCvId } : {}),
        overrideFlag: decision === 'overridden',
      });
    }

    return this.getTrackerDetail(userId, jobId);
  }

  updateTrackerVerdictDecision(
    userId: string,
    jobId: string,
    input: UpdateTrackerVerdictRequest,
  ): UpdateTrackerVerdictResponse {
    const tracker = this.repository.getTrackerItemByJobId(jobId);
    if (!tracker || tracker.userId !== userId) {
      throw new Error(`Tracker item for ${jobId} was not found.`);
    }
    if (input.decision !== 'pending' && !tracker.recommendationSnapshot?.verdict) {
      throw new Error('No verdict exists for this tracker item.');
    }
    const activeEvaluation = tracker.activeEvaluationId
      ? this.repository.getEvaluationById(tracker.activeEvaluationId)
      : this.repository.getActiveEvaluationByJobId(jobId);
    const updated = patchTrackerVerdictDecision(tracker, input.decision, activeEvaluation, this.clock);
    this.repository.saveTrackerItem(updated);
    this.recordDiagnosticEvent({
      area: 'tracker',
      stage: 'verdict',
      code: input.decision === 'pending' ? 'tracker_verdict_reset' : 'tracker_verdict_updated',
      severity: 'info',
      summary: input.decision === 'pending'
        ? 'Tracker verdict decision was reset to the latest system value.'
        : 'Tracker verdict decision was updated.',
      userId,
      jobId,
      trackerItemId: updated.id,
      payload: {
        previousDecision: tracker.verdictDecision,
        nextDecision: updated.verdictDecision,
        systemVerdict: tracker.recommendationSnapshot?.verdict ?? null,
        trackerDiff: summarizeObjectDiff(
          tracker as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
        before: this.hasEyeSession() ? tracker : undefined,
        after: this.hasEyeSession() ? updated : undefined,
      },
    });
    if (input.decision === 'followed' || input.decision === 'overridden') {
      this.recordEvent(input.decision === 'followed' ? 'verdict_followed' : 'verdict_overridden', userId, {
        userId,
        jobId,
        trackerItemId: updated.id,
        verdict: tracker.recommendationSnapshot?.verdict ?? null,
        overrideFlag: input.decision === 'overridden',
      });
    }
    return this.getTrackerDetail(userId, jobId);
  }

  resolveTrackerDuplicate(
    userId: string,
    jobId: string,
    input: ResolveTrackerDuplicateRequest,
  ): ResolveTrackerDuplicateResponse {
    const tracker = this.repository.getTrackerItemByJobId(jobId);
    const job = this.repository.getJobById(jobId);
    if (!tracker || tracker.userId !== userId || !job || job.userId !== userId) {
      throw new Error(`Tracker item for ${jobId} was not found.`);
    }

    const probableDuplicateKey = buildProbableDuplicateKey(job);
    const currentCandidateJobIds = probableDuplicateKey
      ? this.repository.findProbableDuplicateJobs(userId, probableDuplicateKey, jobId).map((candidate) => candidate.id)
      : [];

    if (input.decision === 'duplicate_confirmed') {
      if (!input.duplicateJobId) {
        throw new Error('duplicateJobId is required when confirming a duplicate.');
      }
      if (input.duplicateJobId === jobId) {
        throw new Error('A tracker item cannot be marked as a duplicate of itself.');
      }
      const duplicateJob = this.repository.getJobById(input.duplicateJobId);
      if (!duplicateJob || duplicateJob.userId !== userId) {
        throw new Error(`Duplicate target ${input.duplicateJobId} was not found.`);
      }
    }

    const trackerWithCurrentCandidates: TrackerItem = {
      ...tracker,
      probableDuplicateJobIds: currentCandidateJobIds,
    };
    const updated = patchTrackerDuplicateResolution(
      trackerWithCurrentCandidates,
      input.decision,
      input.decision === 'duplicate_confirmed' ? (input.duplicateJobId ?? null) : null,
      this.clock,
    );

    this.repository.saveTrackerItem(updated);
    this.recordDiagnosticEvent({
      area: 'tracker',
      stage: 'duplicate',
      code: input.decision === 'pending' ? 'tracker_duplicate_reset' : 'tracker_duplicate_resolved',
      severity: input.decision === 'duplicate_confirmed' ? 'warning' : 'info',
      summary: input.decision === 'duplicate_confirmed'
        ? 'Tracker item was marked as a confirmed duplicate.'
        : input.decision === 'distinct_confirmed'
          ? 'Tracker item was confirmed as a distinct opportunity.'
          : 'Tracker duplicate review was reset.',
      userId,
      jobId,
      trackerItemId: updated.id,
      payload: {
        decision: input.decision,
        duplicateJobId: input.duplicateJobId ?? null,
        probableDuplicateJobIds: currentCandidateJobIds,
        trackerDiff: summarizeObjectDiff(
          trackerWithCurrentCandidates as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
        before: this.hasEyeSession() ? trackerWithCurrentCandidates : undefined,
        after: this.hasEyeSession() ? updated : undefined,
      },
    });
    return this.getTrackerDetail(userId, jobId);
  }

  appendTrackerNote(userId: string, jobId: string, note: string): TrackerDetailResponse {
    const tracker = this.repository.getTrackerItemByJobId(jobId);
    if (!tracker || tracker.userId !== userId) {
      throw new Error(`Tracker item for ${jobId} was not found.`);
    }
    const updated = {
      ...tracker,
      notes: tracker.notes ? `${tracker.notes}\n${note}` : note,
      updatedAt: this.now(),
    };
    this.repository.saveTrackerItem(updated);
    this.recordEvent('notes_added', userId, { userId, jobId });
    return this.getTrackerDetail(userId, jobId);
  }

  getLatestDevOutbox(email: string): EmailOutboxRecord | null {
    return this.repository.getLatestEmailOutbox(normalizeEmail(email));
  }
}
