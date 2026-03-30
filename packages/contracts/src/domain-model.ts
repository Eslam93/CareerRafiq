export type ISODateTimeString = string;

export type SourceIdentifier =
  | 'linkedin'
  | 'indeed'
  | 'glassdoor'
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'manual'
  | 'unsupported';

export type AccountStatus = 'temporary' | 'unverified' | 'verified';
export type EmailVerificationStatus = 'unverified' | 'pending' | 'verified';
export type CVProcessingStatus =
  | 'uploaded'
  | 'processing'
  | 'profile_generated'
  | 'review_required'
  | 'confirmed'
  | 'failed';
export type JobExtractionState =
  | 'captured'
  | 'normalized'
  | 'validated'
  | 'review_required'
  | 'corrected'
  | 'ready_for_evaluation'
  | 'failed';
export type EvaluationState = 'not_started' | 'in_progress' | 'completed' | 'superseded' | 'failed';
export type TrackerStatus =
  | 'saved'
  | 'considering'
  | 'applied'
  | 'interviewing'
  | 'rejected'
  | 'offer'
  | 'archived_not_pursuing';
export type Verdict = 'apply' | 'consider' | 'skip';
export type ReviewGateStatus = 'proceed' | 'review_required' | 'failed';
export type WorkSetup = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'freelance'
  | 'temporary'
  | 'internship'
  | 'unknown';
export type Seniority =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'lead'
  | 'manager'
  | 'director'
  | 'executive'
  | 'unknown';
export type PreferenceLevel = 'top' | 'ok' | 'neutral' | 'not_recommended' | 'hard_skip';
export type RecommendationDecisionState = 'pending' | 'accepted' | 'overridden';
export type VerdictDecisionState = 'pending' | 'followed' | 'overridden';
export type DuplicateResolutionDecision = 'pending' | 'distinct_confirmed' | 'duplicate_confirmed';
export type NextActionCode =
  | 'review_job_data'
  | 'review_fit_before_applying'
  | 'review_major_gaps_before_applying'
  | 'accept_or_override_recommended_cv'
  | 'archive_and_move_on'
  | 'record_offer_decision'
  | 'update_after_interview'
  | 'mark_process_progress'
  | 'apply_with_selected_cv';
export type AiWorkflowStepType =
  | 'cv_file_classification'
  | 'cv_profile_suggestion'
  | 'preference_suggestion'
  | 'job_extraction_fallback'
  | 'job_extraction_validation'
  | 'job_signal_inference';
export type AiArtifactStatus = 'completed' | 'failed' | 'skipped' | 'cached';
export type AiProviderKind = 'openai' | 'deterministic' | 'disabled';
export type FieldProvenance = 'deterministic' | 'ai' | 'merged' | 'user_corrected';
export type DiagnosticArea =
  | 'request'
  | 'auth'
  | 'runtime'
  | 'ops'
  | 'extension'
  | 'capture'
  | 'extraction'
  | 'ai'
  | 'evaluation'
  | 'tracker'
  | 'client';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type EyeSessionStatus = 'active' | 'stopped';
export type ClientSurface = 'web' | 'extension' | 'server' | 'unknown';
export type CvMatchType = 'exact_title' | 'fuzzy_title' | 'exact_content' | 'similar_content';

export interface SeniorityRangePreference {
  minimum: Seniority | null;
  maximum: Seniority | null;
}

export interface CvDocumentClassification {
  isResume: boolean;
  confidence: number;
  reason: string;
  documentTypeLabel: string | null;
}

export interface AiFieldEvidence {
  field: string;
  confidence: number;
  reasons: string[];
  evidence: string[];
  provenance: FieldProvenance;
}

export interface AiConsensusSummary {
  enabled: boolean;
  strategy: 'single_run' | 'multi_run_consensus';
  runs: number;
  agreement: 'single_run' | 'strong' | 'mixed' | 'low';
  triggeredBy: string[];
}

export interface AiArtifactReference {
  id: string;
  stepType: AiWorkflowStepType;
  status: AiArtifactStatus;
  provider: AiProviderKind;
  model: string | null;
  promptVersion: string;
  overallConfidence: number;
  createdAt: ISODateTimeString;
}

export interface AiArtifact {
  id: string;
  userId: string;
  stepType: AiWorkflowStepType;
  relatedEntityType: 'user' | 'cv' | 'cv_profile' | 'preference_profile' | 'job' | 'evaluation';
  relatedEntityId: string;
  status: AiArtifactStatus;
  provider: AiProviderKind;
  model: string | null;
  promptVersion: string;
  inputHash: string;
  cacheKey: string;
  overallConfidence: number;
  summary: string;
  rawOutput: Record<string, unknown>;
  fieldEvidence: AiFieldEvidence[];
  consensus: AiConsensusSummary | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface User {
  id: string;
  email: string | null;
  defaultCvId: string | null;
  accountStatus: AccountStatus;
  emailVerificationStatus: EmailVerificationStatus;
  authMethod: 'magic_link';
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  lastVerifiedLoginAt: ISODateTimeString | null;
  temporarySessionExpiresAt: ISODateTimeString | null;
}

export interface CV {
  id: string;
  userId: string;
  fileName: string;
  originalFileName: string | null;
  rawText: string | null;
  extractedEmail: string | null;
  processingStatus: CVProcessingStatus;
  contentHash: string | null;
  latestVersionId: string | null;
  latestClassification: CvDocumentClassification | null;
  uploadedAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface CVVersion {
  id: string;
  cvId: string;
  userId: string;
  fileName: string;
  originalFileName: string | null;
  rawText: string | null;
  contentHash: string | null;
  classification: CvDocumentClassification | null;
  uploadedAt: ISODateTimeString;
  supersededAt: ISODateTimeString | null;
}

export interface CVProfile {
  id: string;
  userId: string;
  cvId: string;
  cvName: string;
  primaryRole: string | null;
  secondaryRoles: string[];
  seniority: Seniority;
  careerTrack: string | null;
  coreStack: string[];
  positioningSummary: string;
  excludedDomains: string[];
  inferredValues: Record<string, unknown>;
  confirmedValues: Record<string, unknown>;
  overrideValues: Record<string, unknown>;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface PreferenceProfile {
  id: string;
  userId: string;
  strictLocationHandling: boolean;
  workSetupPreferences: Record<Exclude<WorkSetup, 'unknown'>, PreferenceLevel>;
  employmentTypePreferences: Record<Exclude<EmploymentType, 'unknown'>, PreferenceLevel>;
  preferredSeniorityRange: SeniorityRangePreference;
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
  inferredValues: Record<string, unknown>;
  confirmedValues: Record<string, unknown>;
  overrideValues: Record<string, unknown>;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface NormalizedJob {
  title: string | null;
  company: string | null;
  location: string | null;
  workSetup: WorkSetup;
  employmentType: EmploymentType;
  description: string;
  recruiterOrPosterSignal: string | null;
  companySector: string | null;
  companyType: string | null;
  keywords: string[];
  scopeSignals: string[];
  greenfieldSignal: boolean | null;
  highOwnershipSignal: boolean | null;
}

export interface Job {
  id: string;
  userId: string;
  sourceIdentifier: SourceIdentifier;
  sourceUrl: string | null;
  rawCaptureContent: string | null;
  normalizedJobObject: NormalizedJob;
  extractionConfidence: number;
  captureSourceType: SourceIdentifier;
  extractionVersion: string;
  jobExtractionState: JobExtractionState;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface CriterionScore {
  criterion: string;
  score: number;
  maxScore: number;
  note: string;
}

export interface SubcriterionScore {
  criterion: string;
  subcriterion: string;
  score: number;
  maxScore: number;
  note: string;
}

export interface AppliedPenalty {
  code: string;
  label: string;
  severity: number;
  impact: number;
  reason: string;
}

export interface EvaluationEvidencePayload {
  matchedSignals: string[];
  gapSignals: string[];
  hardSkipReasons: string[];
  recommendationReasons: string[];
}

export interface NextAction {
  code: NextActionCode;
  label: string;
  rationale: string;
}

export interface ExplanationSourceFields {
  jobFields: string[];
  cvFields: string[];
  preferenceFields: string[];
  usedInferredCompanyOrSectorSignal: boolean;
}

export interface EvaluationNormalizedJobDescriptor {
  titleTokens: string[];
  roleTrack: string | null;
  seniority: Seniority;
  locationTokens: string[];
  workSetup: WorkSetup;
  employmentType: EmploymentType;
  keywordTokens: string[];
  companySector: string | null;
  companyType: string | null;
  inferredCompanySector: string | null;
  inferredCompanyType: string | null;
  scopeSignals: string[];
  greenfieldSignal: boolean | null;
  highOwnershipSignal: boolean | null;
}

export interface EvaluationNormalizedPreferenceDescriptor {
  preferredRoleTracks: string[];
  avoidedRoleTracks: string[];
  preferredJobTitles: string[];
  avoidedJobTitles: string[];
  preferredLocations: string[];
  avoidedLocations: string[];
  preferredSectors: string[];
  avoidedSectors: string[];
  preferredCompanyTypes: string[];
  avoidedCompanyTypes: string[];
  preferredKeywords: string[];
  requiredKeywords: string[];
  avoidedKeywords: string[];
  preferredSeniorityRange: SeniorityRangePreference;
  scopePreferences: string[];
  preferGreenfield: boolean;
  preferHighOwnership: boolean;
}

export interface EvaluationNormalizedComparisonDescriptors {
  version: string;
  job: EvaluationNormalizedJobDescriptor;
  preferences: EvaluationNormalizedPreferenceDescriptor;
}

export interface EvaluationPipelineStep {
  name:
    | 'normalize_inputs'
    | 'validate_inputs'
    | 'score_cv_comparisons'
    | 'select_recommendation'
    | 'generate_verdict'
    | 'generate_explanation'
    | 'review_gate';
  status: 'completed' | 'skipped';
  note: string;
}

export interface EvaluationDecisionTrace {
  pipelineSteps: EvaluationPipelineStep[];
  consensus: AiConsensusSummary;
  confidence: {
    extractionConfidence: number;
    informationQualityScore: number;
    reviewGateStatus: ReviewGateStatus;
  };
}

export interface EvaluationResult {
  id: string;
  jobId: string;
  evaluatedCvResults: EvaluatedCvResult[];
  recommendedCvId: string | null;
  verdict: Verdict | null;
  totalScore: number | null;
  criterionScores: CriterionScore[];
  subcriterionScores: SubcriterionScore[];
  appliedPenalties: AppliedPenalty[];
  hardSkipApplied: boolean;
  reviewGateStatus: ReviewGateStatus;
  evaluationVersion: string;
  scoringVersion: string;
  extractionVersion: string;
  informationQualityScore: number;
  unknownDataFlags: string[];
  explanationEvidencePayload: EvaluationEvidencePayload;
  explanationSourceFields: ExplanationSourceFields;
  normalizedComparisonDescriptors: EvaluationNormalizedComparisonDescriptors;
  decisionTrace: EvaluationDecisionTrace;
  aiArtifactReferences: AiArtifactReference[];
  conciseExplanation: string;
  majorGapsSummary: string[];
  detailedExplanation: string;
  suggestedCvChanges: string[];
  nextAction: NextAction | null;
  active: boolean;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface EvaluatedCvResult {
  cvId: string;
  totalScore: number;
  hardSkipApplied: boolean;
  criterionScores: CriterionScore[];
  subcriterionScores: SubcriterionScore[];
  appliedPenalties: AppliedPenalty[];
  note: string;
}

export interface TrackerDecisionHistoryEntry {
  id: string;
  type: 'recommendation' | 'verdict' | 'duplicate';
  action:
    | 'accepted'
    | 'overridden'
    | 'reset'
    | 'followed'
    | 'distinct_confirmed'
    | 'duplicate_confirmed';
  timestamp: ISODateTimeString;
  evaluationId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface TrackerDuplicateResolution {
  decision: DuplicateResolutionDecision;
  duplicateJobId: string | null;
  dismissedJobIds: string[];
  resolvedAt: ISODateTimeString | null;
}

export interface TrackerItem {
  id: string;
  userId: string;
  jobId: string;
  currentStatus: TrackerStatus;
  notes: string;
  manualOverrides: Record<string, unknown>;
  userSelectedCvId: string | null;
  recommendedCvDecision: RecommendationDecisionState;
  verdictDecision: VerdictDecisionState;
  activeEvaluationId: string | null;
  historicalEvaluationIds: string[];
  recommendationSnapshot: {
    recommendedCvId: string | null;
    verdict: Verdict | null;
    totalScore: number | null;
  } | null;
  nextActionSnapshot: NextAction | null;
  probableDuplicateJobIds: string[];
  duplicateResolution: TrackerDuplicateResolution;
  decisionHistory: TrackerDecisionHistoryEntry[];
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  archivedAt: ISODateTimeString | null;
}

export interface EyeSession {
  id: string;
  operatorUserId: string;
  label: string | null;
  status: EyeSessionStatus;
  startedAt: ISODateTimeString;
  endedAt: ISODateTimeString | null;
  lastEventAt: ISODateTimeString | null;
  webAppVersion: string | null;
  extensionVersion: string | null;
  notes: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface DiagnosticEvent {
  id: string;
  eyeSessionId: string | null;
  requestId: string | null;
  userId: string | null;
  jobId: string | null;
  trackerItemId: string | null;
  area: DiagnosticArea;
  stage: string;
  code: string;
  severity: DiagnosticSeverity;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: ISODateTimeString;
}
