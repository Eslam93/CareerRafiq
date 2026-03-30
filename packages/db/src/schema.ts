import type {
  AiArtifact,
  CV,
  CVProfile,
  CVVersion,
  DiagnosticEvent,
  EvaluationResult,
  EyeSession,
  Job,
  PreferenceProfile,
  TrackerItem,
  User,
} from '@career-rafiq/contracts';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnalyticsEventRecord, DiagnosticEventRecord, EmailOutboxRecord, EyeSessionRecord, JobExtractionRecord, SessionRecord, StoredAiArtifact, StoredCvFile, StoredCvVersion, StoredMagicLinkToken } from './types.js';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    accountStatus: text('account_status').notNull(),
    emailVerificationStatus: text('email_verification_status').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<User>().notNull(),
  },
  (table) => ({
    emailIdx: index('users_email_idx').on(table.email),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    accessLevel: text('access_level').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
  }),
);

export const magicLinkTokens = sqliteTable(
  'magic_link_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull(),
    data: text('data', { mode: 'json' }).$type<StoredMagicLinkToken>().notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('magic_link_tokens_token_hash_unique').on(table.tokenHash),
    userIdIdx: index('magic_link_tokens_user_id_idx').on(table.userId),
    emailIdx: index('magic_link_tokens_email_idx').on(table.email),
  }),
);

export const emailOutbox = sqliteTable(
  'email_outbox',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    email: text('email').notNull(),
    kind: text('kind').notNull(),
    createdAt: text('created_at').notNull(),
    data: text('data', { mode: 'json' }).$type<EmailOutboxRecord>().notNull(),
  },
  (table) => ({
    emailIdx: index('email_outbox_email_idx').on(table.email, table.createdAt),
  }),
);

export const cvs = sqliteTable(
  'cvs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    fileName: text('file_name').notNull(),
    extractedEmail: text('extracted_email'),
    processingStatus: text('processing_status').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<StoredCvFile>().notNull(),
  },
  (table) => ({
    userIdIdx: index('cvs_user_id_idx').on(table.userId, table.uploadedAt),
  }),
);

export const cvProfiles = sqliteTable(
  'cv_profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    cvId: text('cv_id').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<CVProfile>().notNull(),
  },
  (table) => ({
    userIdIdx: index('cv_profiles_user_id_idx').on(table.userId),
    cvIdUnique: uniqueIndex('cv_profiles_cv_id_unique').on(table.cvId),
  }),
);

export const cvVersions = sqliteTable(
  'cv_versions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    cvId: text('cv_id').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
    supersededAt: text('superseded_at'),
    data: text('data', { mode: 'json' }).$type<StoredCvVersion>().notNull(),
  },
  (table) => ({
    cvIdIdx: index('cv_versions_cv_id_idx').on(table.cvId, table.uploadedAt),
    userIdIdx: index('cv_versions_user_id_idx').on(table.userId, table.uploadedAt),
  }),
);

export const preferenceProfiles = sqliteTable(
  'preference_profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<PreferenceProfile>().notNull(),
  },
  (table) => ({
    userIdUnique: uniqueIndex('preference_profiles_user_id_unique').on(table.userId),
  }),
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sourceIdentifier: text('source_identifier').notNull(),
    sourceUrl: text('source_url'),
    sourceUrlKey: text('source_url_key'),
    probableDuplicateKey: text('probable_duplicate_key'),
    jobExtractionState: text('job_extraction_state').notNull(),
    extractionConfidence: integer('extraction_confidence').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<Job>().notNull(),
  },
  (table) => ({
    userIdIdx: index('jobs_user_id_idx').on(table.userId, table.updatedAt),
    sourceUrlIdx: index('jobs_source_url_idx').on(table.userId, table.sourceUrlKey),
    probableDuplicateIdx: index('jobs_probable_duplicate_idx').on(table.userId, table.probableDuplicateKey),
  }),
);

export const jobExtractions = sqliteTable(
  'job_extractions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    jobId: text('job_id').notNull(),
    sourceIdentifier: text('source_identifier').notNull(),
    sourceUrl: text('source_url'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<JobExtractionRecord>().notNull(),
  },
  (table) => ({
    jobIdUnique: uniqueIndex('job_extractions_job_id_unique').on(table.jobId),
    userIdIdx: index('job_extractions_user_id_idx').on(table.userId),
  }),
);

export const evaluations = sqliteTable(
  'evaluations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    jobId: text('job_id').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
    evaluationVersion: text('evaluation_version').notNull(),
    scoringVersion: text('scoring_version').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<EvaluationResult>().notNull(),
  },
  (table) => ({
    jobIdIdx: index('evaluations_job_id_idx').on(table.jobId, table.createdAt),
    activeIdx: index('evaluations_active_idx').on(table.jobId, table.active),
  }),
);

export const aiArtifacts = sqliteTable(
  'ai_artifacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    relatedEntityType: text('related_entity_type').notNull(),
    relatedEntityId: text('related_entity_id').notNull(),
    stepType: text('step_type').notNull(),
    status: text('status').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    promptVersion: text('prompt_version').notNull(),
    inputHash: text('input_hash').notNull(),
    cacheKey: text('cache_key').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<StoredAiArtifact>().notNull(),
  },
  (table) => ({
    cacheKeyUnique: uniqueIndex('ai_artifacts_cache_key_unique').on(table.cacheKey),
    userIdIdx: index('ai_artifacts_user_id_idx').on(table.userId, table.createdAt),
    entityIdx: index('ai_artifacts_entity_idx').on(table.relatedEntityType, table.relatedEntityId, table.createdAt),
    stepTypeIdx: index('ai_artifacts_step_type_idx').on(table.userId, table.stepType, table.createdAt),
  }),
);

export const trackerItems = sqliteTable(
  'tracker_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    jobId: text('job_id').notNull(),
    currentStatus: text('current_status').notNull(),
    recommendedCvDecision: text('recommended_cv_decision').notNull(),
    verdictDecision: text('verdict_decision').notNull(),
    selectedCvId: text('selected_cv_id'),
    nextActionCode: text('next_action_code'),
    activeEvaluationId: text('active_evaluation_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<TrackerItem>().notNull(),
  },
  (table) => ({
    jobIdUnique: uniqueIndex('tracker_items_job_id_unique').on(table.jobId),
    userIdIdx: index('tracker_items_user_id_idx').on(table.userId, table.updatedAt),
    recommendedDecisionIdx: index('tracker_items_recommended_cv_decision_idx').on(table.userId, table.recommendedCvDecision),
    verdictDecisionIdx: index('tracker_items_verdict_decision_idx').on(table.userId, table.verdictDecision),
    selectedCvIdx: index('tracker_items_selected_cv_idx').on(table.userId, table.selectedCvId),
    nextActionIdx: index('tracker_items_next_action_idx').on(table.userId, table.nextActionCode),
  }),
);

export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    name: text('name').notNull(),
    timestamp: text('timestamp').notNull(),
    data: text('data', { mode: 'json' }).$type<AnalyticsEventRecord>().notNull(),
  },
  (table) => ({
    nameIdx: index('analytics_events_name_idx').on(table.name),
    userIdIdx: index('analytics_events_user_id_idx').on(table.userId, table.timestamp),
  }),
);

export const eyeSessions = sqliteTable(
  'eye_sessions',
  {
    id: text('id').primaryKey(),
    operatorUserId: text('operator_user_id').notNull(),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    lastEventAt: text('last_event_at'),
    updatedAt: text('updated_at').notNull(),
    data: text('data', { mode: 'json' }).$type<EyeSessionRecord>().notNull(),
  },
  (table) => ({
    operatorUserIdIdx: index('eye_sessions_operator_user_id_idx').on(table.operatorUserId, table.updatedAt),
    statusIdx: index('eye_sessions_status_idx').on(table.operatorUserId, table.status),
  }),
);

export const diagnosticEvents = sqliteTable(
  'diagnostic_events',
  {
    id: text('id').primaryKey(),
    eyeSessionId: text('eye_session_id'),
    requestId: text('request_id'),
    userId: text('user_id'),
    jobId: text('job_id'),
    trackerItemId: text('tracker_item_id'),
    area: text('area').notNull(),
    severity: text('severity').notNull(),
    createdAt: text('created_at').notNull(),
    data: text('data', { mode: 'json' }).$type<DiagnosticEventRecord>().notNull(),
  },
  (table) => ({
    eyeSessionIdIdx: index('diagnostic_events_eye_session_id_idx').on(table.eyeSessionId, table.createdAt),
    requestIdIdx: index('diagnostic_events_request_id_idx').on(table.requestId, table.createdAt),
    userIdIdx: index('diagnostic_events_user_id_idx').on(table.userId, table.createdAt),
    areaIdx: index('diagnostic_events_area_idx').on(table.area, table.createdAt),
    severityIdx: index('diagnostic_events_severity_idx').on(table.severity, table.createdAt),
  }),
);

export type StoredTables = {
  users: typeof users;
  sessions: typeof sessions;
  magicLinkTokens: typeof magicLinkTokens;
  emailOutbox: typeof emailOutbox;
  cvs: typeof cvs;
  cvProfiles: typeof cvProfiles;
  cvVersions: typeof cvVersions;
  preferenceProfiles: typeof preferenceProfiles;
  jobs: typeof jobs;
  jobExtractions: typeof jobExtractions;
  evaluations: typeof evaluations;
  aiArtifacts: typeof aiArtifacts;
  trackerItems: typeof trackerItems;
  analyticsEvents: typeof analyticsEvents;
  eyeSessions: typeof eyeSessions;
  diagnosticEvents: typeof diagnosticEvents;
};

export type PersistedCvRecord = CV;
export type PersistedCvVersionRecord = CVVersion;
