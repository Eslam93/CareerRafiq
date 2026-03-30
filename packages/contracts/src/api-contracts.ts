import type {
  AiArtifactReference,
  ClientSurface,
  CVVersion,
  DiagnosticArea,
  DiagnosticEvent,
  DiagnosticSeverity,
  EyeSession,
  EvaluationResult,
  Job,
  NextAction,
  PreferenceProfile,
  RecommendationDecisionState,
  ReviewGateStatus,
  Seniority,
  SourceIdentifier,
  TrackerItem,
  TrackerStatus,
  User,
  VerdictDecisionState,
  CV,
  CVProfile,
  CvDocumentClassification,
  CvMatchType,
} from './domain-model.js';
import type { AnalyticsEventCommonProps, AnalyticsEventName } from './analytics-events.js';
import type { ExtractionPayload, ExtractionValidationResult } from './extraction-contract.js';

export interface SetupBootstrapRequest {
  uploads: Array<{
    fileName: string;
    rawText: string;
  }>;
}

export interface SetupBootstrapResponse {
  user: User;
  cvs: CV[];
  cvProfiles: CVProfile[];
  preferenceProfile: PreferenceProfile;
  magicLinkToken: string | null;
  minimumUsableDataReady: boolean;
  detectedEmails: string[];
  selectedEmailCandidate: string | null;
  emailConflictDetected: boolean;
  emailCollectionRequired: boolean;
  returnAccessRequiresVerification: boolean;
  setupWarnings: string[];
  setupAiArtifacts: AiArtifactReference[];
  preferenceAudits: PreferenceAuditIssue[];
  uploadResults: CvUploadAnalysisResult[];
}

export interface CaptureJobRequest {
  extraction: ExtractionPayload;
}

export interface CaptureJobResponse {
  validation: ExtractionValidationResult;
  job: Job | null;
  trackerItem: TrackerItem | null;
}

export interface ExtractPageRequest {
  sourceUrl: string;
  pageContent: string;
  sourceIdentifier?: SourceIdentifier;
}

export interface ExtractPageResponse {
  extraction: ExtractionPayload;
  supported: boolean;
  detectedSourceIdentifier: SourceIdentifier;
}

export interface CapturePageRequest extends ExtractPageRequest {}

export interface CapturePageResponse extends CaptureJobResponse {
  extraction: ExtractionPayload;
  supported: boolean;
  detectedSourceIdentifier: SourceIdentifier;
}

export interface BootstrapCurrentResponse {
  bootstrap: SetupBootstrapResponse | null;
}

export interface SetupCurrentResponse extends BootstrapCurrentResponse {}

export interface PreferenceAuditIssue {
  type: 'duplicate' | 'near_duplicate' | 'contradiction' | 'weak_value';
  severity: 'info' | 'warning';
  fields: string[];
  values: string[];
  normalizedValues: string[];
  message: string;
}

export interface UpdateCvProfileRequest {
  cvName: string;
  primaryRole: string | null;
  secondaryRoles: string[];
  seniority: Seniority;
  careerTrack: string | null;
  coreStack: string[];
  positioningSummary: string;
  excludedDomains: string[];
}

export interface UpdateCvProfileResponse {
  cvProfile: CVProfile;
  reevaluatedJobIds: string[];
}

export type CvUploadStatus =
  | 'accepted'
  | 'rejected_non_cv'
  | 'resolution_required'
  | 'updated_existing'
  | 'created_new';

export interface CvMatchCandidate {
  candidateCvId: string;
  candidateCvName: string;
  matchType: CvMatchType;
  score: number;
  reasons: string[];
}

export interface CvUploadAnalysisResult {
  uploadToken: string;
  fileName: string;
  mimeType: string | null;
  status: Extract<CvUploadStatus, 'accepted' | 'rejected_non_cv' | 'resolution_required'>;
  classification: CvDocumentClassification | null;
  warning: string | null;
  extractedTextLength: number;
  candidateMatches: CvMatchCandidate[];
}

export interface CvUploadCommitDecision {
  uploadToken: string;
  decision: 'create_new' | 'update_existing';
  targetCvId?: string | null;
}

export interface AnalyzeCvUploadResponse {
  items: CvUploadAnalysisResult[];
}

export interface CommitCvUploadResponse {
  items: Array<{
    uploadToken: string;
    fileName: string;
    status: Extract<CvUploadStatus, 'created_new' | 'updated_existing'>;
    cvId: string;
  }>;
  bootstrap: SetupBootstrapResponse;
  reevaluatedJobIds: string[];
}

export interface CvListResponse {
  items: Array<{
    cv: CV;
    cvProfile: CVProfile | null;
    isDefault: boolean;
    versionCount: number;
    lastUpdatedAt: string;
  }>;
  defaultCvId: string | null;
}

export interface CvDetailResponse {
  cv: CV;
  cvProfile: CVProfile | null;
  versions: CVVersion[];
  isDefault: boolean;
}

export interface UpdatePreferencesRequest {
  preferenceProfile: PreferenceProfile;
  reevaluateTrackedJobs?: boolean;
}

export interface UpdatePreferencesResponse {
  preferenceProfile: PreferenceProfile;
  audits: PreferenceAuditIssue[];
  reevaluatedJobIds: string[];
}

export interface RefreshSetupSuggestionsRequest {
  reevaluateTrackedJobs?: boolean;
}

export interface RefreshSetupSuggestionsResponse {
  bootstrap: SetupBootstrapResponse;
  reevaluatedJobIds: string[];
}

export interface AuthSessionResponse {
  authenticated: boolean;
  accessLevel: 'anonymous' | 'temporary' | 'verified';
  user: User | null;
  sessionExpiresAt: string | null;
  returnAccessRequiresVerification: boolean;
  emailCollectionRequired: boolean;
}

export interface MagicLinkRequestRequest {
  email: string;
}

export interface MagicLinkRequestResponse {
  sentTo: string;
  expiresAt: string | null;
}

export interface OpsSummaryResponse {
  summary: {
    user: {
      id: string;
      email: string | null;
      accountStatus: User['accountStatus'];
      emailVerificationStatus: User['emailVerificationStatus'];
    };
    tracker: {
      totalItems: number;
      reviewRequiredItems: number;
      duplicateCandidateItems: number;
      itemsWithActiveEvaluation: number;
      byStatus: Array<{
        status: TrackerStatus;
        count: number;
      }>;
      reviewQueue: Array<{
        jobId: string;
        title: string | null;
        company: string | null;
        currentStatus: TrackerStatus | null;
        updatedAt: string;
        reviewReasons: string[];
      }>;
      duplicateQueue: Array<{
        jobId: string;
        title: string | null;
        company: string | null;
        duplicateCount: number;
        updatedAt: string;
      }>;
      overrideActiveItems: Array<{
        jobId: string;
        title: string | null;
        company: string | null;
        recommendedCvDecision: RecommendationDecisionState;
        verdictDecision: VerdictDecisionState;
        updatedAt: string;
      }>;
    };
    analytics: {
      totalEvents: number;
      byName: Array<{
        name: AnalyticsEventName;
        count: number;
      }>;
      missingKeyEvents: AnalyticsEventName[];
    };
    email: {
      currentAddress: string | null;
      latestDeliveryStatus: 'queued' | 'sent' | 'failed' | 'dev_outbox' | null;
      latestDeliveryProvider: 'smtp' | 'dev_outbox' | 'disabled' | null;
      latestCreatedAt: string | null;
      latestAttemptAt: string | null;
    };
  };
}

export interface DevEmailOutboxResponse {
  message: {
    id: string;
    email: string;
    kind: 'magic_link';
    subject: string;
    body: string;
    deliveryStatus: 'queued' | 'sent' | 'failed' | 'dev_outbox';
    deliveryProvider: 'smtp' | 'dev_outbox' | 'disabled';
    sentAt: string | null;
    lastAttemptAt: string | null;
    errorMessage: string | null;
    externalMessageId: string | null;
    createdAt: string;
  } | null;
}

export interface RuntimeReadinessResponse {
  checks: {
    databaseReady: boolean;
    emailDeliveryConfigured: boolean;
    aiProviderConfigured: boolean;
    webBundleReady?: boolean;
  };
  ai: {
    configuredFlags: {
      aiSetupSuggestions: boolean;
      aiExtractionFallback: boolean;
      aiSignalInference: boolean;
      aiConsensus: boolean;
    };
    activeFeatures: {
      aiSetupSuggestions: boolean;
      aiExtractionFallback: boolean;
      aiSignalInference: boolean;
      aiConsensus: boolean;
    };
  };
  warnings: string[];
  timestamp: string;
}

export interface RuntimeDetailResponse {
  eye: {
    enabled: boolean;
    retentionDays: number;
  };
  origins: {
    allowed: string[];
    web: string | null;
    extension: string | null;
  };
  cookies: {
    secure: boolean;
    sameSite: 'none' | 'lax';
    insecureDevCookie: boolean;
  };
  rateLimits: {
    upload: {
      max: number;
      windowSeconds: number;
    };
    capture: {
      max: number;
      windowSeconds: number;
    };
    magicLinkThrottleSeconds: number;
  };
  email: {
    providerMode: 'smtp' | 'dev_outbox' | 'disabled';
    fromAddress: string;
  };
  correlation: {
    requestIdHeader: string;
    eyeSessionHeader: string;
    clientSurfaceHeader: string;
  };
  timestamp: string;
}

export interface EyeCurrentResponse {
  enabled: boolean;
  operatorAccess: boolean;
  session: EyeSession | null;
}

export interface StartEyeSessionRequest {
  label?: string | null;
  webAppVersion?: string | null;
  extensionVersion?: string | null;
  notes?: string | null;
}

export interface EyeSessionResponse {
  session: EyeSession | null;
}

export interface EyeSessionsResponse {
  sessions: EyeSession[];
}

export interface ListDiagnosticEventsRequest {
  eyeSessionId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  area?: DiagnosticArea | null;
  severity?: DiagnosticSeverity | null;
  sinceMinutes?: number | null;
  limit?: number | null;
}

export interface DiagnosticEventsResponse {
  events: DiagnosticEvent[];
}

export interface DiagnosticEventResponse {
  event: DiagnosticEvent | null;
}

export interface RecordClientDiagnosticEventRequest {
  eyeSessionId?: string | null;
  area: DiagnosticArea;
  stage: string;
  code: string;
  severity: DiagnosticSeverity;
  summary: string;
  requestId?: string | null;
  jobId?: string | null;
  trackerItemId?: string | null;
  payload?: Record<string, unknown>;
  clientSurface?: ClientSurface;
}

export interface RecordClientDiagnosticEventResponse {
  ok: true;
  event: DiagnosticEvent | null;
}

export interface TrackerListResponse {
  items: Array<{
    trackerItem: TrackerItem;
    job: Job;
    evaluation: EvaluationResult | null;
    recommendedCvName: string | null;
    selectedCvName: string | null;
  }>;
}

export interface TrackerDetailResponse {
  trackerItem: TrackerItem | null;
  job: Job | null;
  evaluation: EvaluationResult | null;
  validation: ExtractionValidationResult | null;
  extractionMeta: JobExtractionMeta | null;
  historicalEvaluations: EvaluationResult[];
  availableCvs: Array<{
    cvId: string;
    cvName: string;
  }>;
  probableDuplicates: Array<{
    jobId: string;
    title: string | null;
    company: string | null;
    currentStatus: string | null;
  }>;
}

export interface JobReviewResponse extends TrackerDetailResponse {}

export interface UpdateJobReviewRequest {
  title: string | null;
  company: string | null;
  location: string | null;
  workSetup: Job['normalizedJobObject']['workSetup'];
  employmentType: Job['normalizedJobObject']['employmentType'];
  description: string;
  recruiterOrPosterSignal: string | null;
  companySector: string | null;
  companyType: string | null;
  keywords: string[];
  reevaluateAfterSave?: boolean;
}

export interface CaptureManualJobRequest {
  sourceUrl?: string | null;
  sourceIdentifier?: SourceIdentifier;
  title: string | null;
  company: string | null;
  location: string | null;
  workSetup: Job['normalizedJobObject']['workSetup'];
  employmentType: Job['normalizedJobObject']['employmentType'];
  description: string | null;
  recruiterOrPosterSignal: string | null;
  companySector: string | null;
  companyType: string | null;
  keywords: string[];
}

export interface EvaluateJobRequest {
  jobId: string;
}

export interface EvaluateJobResponse {
  evaluation: EvaluationResult;
  trackerItem: TrackerItem | null;
  recommendedCvName: string | null;
}

export interface UploadAdditionalCvsResponse {
  bootstrap: SetupBootstrapResponse;
  addedCvIds: string[];
  reevaluatedJobIds: string[];
}

export interface SetDefaultCvRequest {
  cvId: string;
  reevaluateTrackedJobs?: boolean;
}

export interface SetDefaultCvResponse {
  user: User;
  bootstrap: SetupBootstrapResponse | null;
  reevaluatedJobIds: string[];
}

export interface TrackerUpsertRequest {
  trackerItem: TrackerItem;
}

export interface TrackerUpsertResponse {
  trackerItem: TrackerItem;
}

export interface MagicLinkSendRequest {
  userId: string;
  email: string;
}

export interface MagicLinkSendResponse {
  token: string;
  sentTo: string;
}

export interface MagicLinkVerifyRequest {
  token: string;
  email: string;
}

export interface MagicLinkVerifyResponse {
  verified: boolean;
  userId: string | null;
  accessLevel?: 'temporary' | 'verified';
}

export interface MagicLinkConsumeResponse extends MagicLinkVerifyResponse {
  user: User | null;
}

export interface LogoutResponse {
  ok: true;
}

export interface TrackAnalyticsEventRequest {
  name: AnalyticsEventName;
  properties?: AnalyticsEventCommonProps & Record<string, unknown>;
}

export interface TrackAnalyticsEventResponse {
  ok: true;
}

export interface UpdateTrackerRecommendationRequest {
  decision: RecommendationDecisionState;
  selectedCvId?: string | null;
}

export interface UpdateTrackerRecommendationResponse extends TrackerDetailResponse {}

export interface UpdateTrackerVerdictRequest {
  decision: VerdictDecisionState;
}

export interface UpdateTrackerVerdictResponse extends TrackerDetailResponse {}

export interface ResolveTrackerDuplicateRequest {
  decision: import('./domain-model.js').DuplicateResolutionDecision;
  duplicateJobId?: string | null;
}

export interface ResolveTrackerDuplicateResponse extends TrackerDetailResponse {}

export interface JobExtractionHistoryEntry {
  timestamp: string;
  action: 'captured' | 'reextracted' | 'review_edited' | 'review_confirmed';
  status: ReviewGateStatus;
  extractionConfidence: number;
  note: string;
  source: 'deterministic' | 'ai' | 'merged' | 'manual';
}

export interface JobExtractionMeta {
  extractionVersion: string;
  sourceConfidenceHints: string[];
  ambiguityFlags: string[];
  extractionNotes: string[];
  reviewCount: number;
  fieldEvidence: Array<{
    field: string;
    confidence: number;
    provenance: import('./domain-model.js').FieldProvenance;
    evidence: string[];
    reasons: string[];
  }>;
  mergedFieldProvenance: Record<string, import('./domain-model.js').FieldProvenance>;
  aiArtifactReferences: AiArtifactReference[];
  consensusSummary: import('./domain-model.js').AiConsensusSummary | null;
  coherenceAssessment: {
    isSingleJob: boolean;
    confidence: number;
    note: string;
  } | null;
  sourceOfTruthSummary: string | null;
  history: JobExtractionHistoryEntry[];
}
