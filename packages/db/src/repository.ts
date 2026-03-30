import { and, desc, eq, ne } from 'drizzle-orm';
import type {
  AiArtifact,
  CV,
  CVProfile,
  CVVersion,
  DiagnosticEvent,
  EvaluationResult,
  EyeSession,
  JobExtractionMeta,
  Job,
  PreferenceProfile,
  TrackerItem,
  User,
} from '@career-rafiq/contracts';
import { createDatabaseClient, type DatabaseClient } from './client.js';
import {
  analyticsEvents,
  cvs,
  cvVersions,
  diagnosticEvents,
  cvProfiles,
  emailOutbox,
  eyeSessions,
  evaluations,
  aiArtifacts,
  jobs,
  jobExtractions,
  magicLinkTokens,
  preferenceProfiles,
  sessions,
  trackerItems,
  users,
} from './schema.js';
import type {
  AnalyticsEventRecord,
  DiagnosticEventRecord,
  EmailOutboxRecord,
  EyeSessionRecord,
  JobExtractionRecord,
  SessionRecord,
  SetupStateRecord,
  StoredAiArtifact,
  StoredCvFile,
  StoredCvVersion,
  StoredMagicLinkToken,
  TrackerDetailRecord,
} from './types.js';

export interface SaveJobInput {
  job: Job;
  sourceUrlKey: string | null;
  probableDuplicateKey: string | null;
}

function assertValue<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

function sortByUpdatedAtDescending<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeEvaluationResult(evaluation: EvaluationResult): EvaluationResult {
  return {
    ...evaluation,
    extractionVersion: evaluation.extractionVersion ?? 'extraction-v1',
    informationQualityScore: typeof evaluation.informationQualityScore === 'number'
      ? evaluation.informationQualityScore
      : evaluation.reviewGateStatus === 'proceed'
        ? 80
        : 40,
    unknownDataFlags: Array.isArray(evaluation.unknownDataFlags) ? evaluation.unknownDataFlags : [],
    explanationSourceFields: evaluation.explanationSourceFields ?? {
      jobFields: [],
      cvFields: [],
      preferenceFields: [],
      usedInferredCompanyOrSectorSignal: false,
    },
    normalizedComparisonDescriptors: evaluation.normalizedComparisonDescriptors ?? {
      version: 'eval-normalization-v1',
      job: {
        titleTokens: [],
        roleTrack: null,
        seniority: 'unknown',
        locationTokens: [],
        workSetup: 'unknown',
        employmentType: 'unknown',
        keywordTokens: [],
        companySector: null,
        companyType: null,
        inferredCompanySector: null,
        inferredCompanyType: null,
        scopeSignals: [],
        greenfieldSignal: null,
        highOwnershipSignal: null,
      },
      preferences: {
        preferredRoleTracks: [],
        avoidedRoleTracks: [],
        preferredJobTitles: [],
        avoidedJobTitles: [],
        preferredLocations: [],
        avoidedLocations: [],
        preferredSectors: [],
        avoidedSectors: [],
        preferredCompanyTypes: [],
        avoidedCompanyTypes: [],
        preferredKeywords: [],
        requiredKeywords: [],
        avoidedKeywords: [],
        preferredSeniorityRange: {
          minimum: null,
          maximum: null,
        },
        scopePreferences: [],
        preferGreenfield: false,
        preferHighOwnership: false,
      },
    },
    decisionTrace: evaluation.decisionTrace ?? {
      pipelineSteps: [],
      consensus: {
        enabled: false,
        strategy: 'single_run',
        runs: 1,
        agreement: 'single_run',
        triggeredBy: [],
      },
      confidence: {
        extractionConfidence: 0,
        informationQualityScore: typeof evaluation.informationQualityScore === 'number' ? evaluation.informationQualityScore : 0,
        reviewGateStatus: evaluation.reviewGateStatus,
      },
    },
    aiArtifactReferences: Array.isArray(evaluation.aiArtifactReferences) ? evaluation.aiArtifactReferences : [],
    nextAction: evaluation.nextAction ?? null,
  };
}

function normalizeJobExtractionRecord(record: JobExtractionRecord): JobExtractionRecord {
  const history = Array.isArray(record.history)
    ? record.history
    : [{
        timestamp: record.createdAt,
        action: 'captured' as const,
        status: record.validation.status,
        extractionConfidence: record.validation.extractionConfidence,
        note: 'Initial capture record.',
        source: 'deterministic' as const,
      }];

  return {
    ...record,
    extractionVersion: record.extractionVersion ?? 'extraction-v1',
    reviewCount: typeof record.reviewCount === 'number'
      ? record.reviewCount
      : history.filter((entry) => entry.action === 'review_edited' || entry.action === 'review_confirmed').length,
    history,
    aiArtifactReferences: Array.isArray(record.aiArtifactReferences) ? record.aiArtifactReferences : [],
    consensusSummary: record.consensusSummary ?? null,
    validation: {
      ...record.validation,
      fieldEvidence: Array.isArray(record.validation.fieldEvidence) ? record.validation.fieldEvidence : [],
      mergedFieldProvenance: record.validation.mergedFieldProvenance ?? {},
      coherenceAssessment: record.validation.coherenceAssessment ?? null,
    },
  };
}

function buildExtractionMeta(record: JobExtractionRecord | null): JobExtractionMeta | null {
  if (!record) {
    return null;
  }

  const normalized = normalizeJobExtractionRecord(record);
  return {
    extractionVersion: normalized.extractionVersion,
    sourceConfidenceHints: normalized.extraction.sourceConfidenceHints,
    ambiguityFlags: normalized.extraction.ambiguityFlags,
    extractionNotes: normalized.extraction.extractionNotes,
    reviewCount: normalized.reviewCount,
    fieldEvidence: normalized.validation.fieldEvidence ?? [],
    mergedFieldProvenance: normalized.validation.mergedFieldProvenance ?? {},
    aiArtifactReferences: normalized.aiArtifactReferences,
    consensusSummary: normalized.consensusSummary,
    coherenceAssessment: normalized.validation.coherenceAssessment ?? null,
    sourceOfTruthSummary: normalized.extraction.sourceOfTruthSummary ?? null,
    history: normalized.history,
  };
}

function normalizeAiArtifact(record: StoredAiArtifact): StoredAiArtifact {
  return {
    ...record,
    fieldEvidence: Array.isArray(record.fieldEvidence) ? record.fieldEvidence : [],
    rawOutput: record.rawOutput ?? {},
    consensus: record.consensus ?? null,
  };
}

function normalizeEyeSession(record: EyeSessionRecord): EyeSessionRecord {
  return {
    ...record,
    label: record.label ?? null,
    endedAt: record.endedAt ?? null,
    lastEventAt: record.lastEventAt ?? null,
    webAppVersion: record.webAppVersion ?? null,
    extensionVersion: record.extensionVersion ?? null,
    notes: record.notes ?? null,
  };
}

function normalizeDiagnosticEvent(record: DiagnosticEventRecord): DiagnosticEventRecord {
  return {
    ...record,
    eyeSessionId: record.eyeSessionId ?? null,
    requestId: record.requestId ?? null,
    userId: record.userId ?? null,
    jobId: record.jobId ?? null,
    trackerItemId: record.trackerItemId ?? null,
    payload: record.payload ?? {},
  };
}

function normalizeStoredCv(record: StoredCvFile): StoredCvFile {
  return {
    ...record,
    contentHash: record.contentHash ?? null,
    latestVersionId: record.latestVersionId ?? null,
    latestClassification: record.latestClassification ?? null,
    mimeType: record.mimeType ?? null,
    storedFilePath: record.storedFilePath ?? null,
  };
}

function normalizeStoredCvVersion(record: StoredCvVersion): StoredCvVersion {
  return {
    ...record,
    originalFileName: record.originalFileName ?? null,
    rawText: record.rawText ?? null,
    contentHash: record.contentHash ?? null,
    classification: record.classification ?? null,
    supersededAt: record.supersededAt ?? null,
    mimeType: record.mimeType ?? null,
    storedFilePath: record.storedFilePath ?? null,
  };
}

function normalizeTrackerItem(item: TrackerItem): TrackerItem {
  const probableDuplicateJobIds = Array.isArray(item.probableDuplicateJobIds)
    ? item.probableDuplicateJobIds
    : Array.isArray(item.manualOverrides['probableDuplicateJobIds'])
      ? (item.manualOverrides['probableDuplicateJobIds'] as string[])
      : [];

  const historicalEvaluationIds = Array.isArray(item.historicalEvaluationIds)
    ? [...new Set(item.historicalEvaluationIds.filter((evaluationId) => evaluationId !== item.activeEvaluationId))]
    : [];

  return {
    ...item,
    userSelectedCvId: item.userSelectedCvId ?? null,
    recommendedCvDecision: item.recommendedCvDecision ?? 'pending',
    verdictDecision: item.verdictDecision ?? 'pending',
    historicalEvaluationIds,
    nextActionSnapshot: item.nextActionSnapshot ?? null,
    probableDuplicateJobIds,
    duplicateResolution: {
      decision: item.duplicateResolution?.decision ?? 'pending',
      duplicateJobId: item.duplicateResolution?.duplicateJobId ?? null,
      dismissedJobIds: Array.isArray(item.duplicateResolution?.dismissedJobIds) ? item.duplicateResolution.dismissedJobIds : [],
      resolvedAt: item.duplicateResolution?.resolvedAt ?? null,
    },
    decisionHistory: Array.isArray(item.decisionHistory) ? item.decisionHistory : [],
  };
}

export class CareerRafiqRepository {
  constructor(private readonly client: DatabaseClient) {}

  static open(filePath?: string): CareerRafiqRepository {
    return new CareerRafiqRepository(createDatabaseClient(filePath));
  }

  close(): void {
    this.client.sqlite.close();
  }

  ping(): boolean {
    try {
      this.client.sqlite.prepare('SELECT 1 AS ok').get();
      return true;
    } catch {
      return false;
    }
  }

  runInTransaction<T>(callback: (repository: CareerRafiqRepository) => T): T {
    const transaction = this.client.sqlite.transaction(() => callback(this));
    return transaction();
  }

  upsertUser(user: User): User {
    this.client.db
      .insert(users)
      .values({
        id: user.id,
        email: user.email,
        accountStatus: user.accountStatus,
        emailVerificationStatus: user.emailVerificationStatus,
        updatedAt: user.updatedAt,
        data: user,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: user.email,
          accountStatus: user.accountStatus,
          emailVerificationStatus: user.emailVerificationStatus,
          updatedAt: user.updatedAt,
          data: user,
        },
      })
      .run();
    return user;
  }

  getUserById(userId: string): User | null {
    const row = this.client.db.select().from(users).where(eq(users.id, userId)).get();
    return assertValue(row?.data);
  }

  getUserByEmail(email: string): User | null {
    const row = this.client.db.select().from(users).where(eq(users.email, email)).get();
    return assertValue(row?.data);
  }

  createSession(record: SessionRecord): SessionRecord {
    this.client.db.insert(sessions).values(record).run();
    return record;
  }

  getSessionByTokenHash(tokenHash: string): SessionRecord | null {
    const row = this.client.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
    if (!row) {
      return null;
    }
    return {
      ...row,
      accessLevel: row.accessLevel as SessionRecord['accessLevel'],
    };
  }

  upsertSession(record: SessionRecord): SessionRecord {
    this.client.db
      .insert(sessions)
      .values(record)
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          userId: record.userId,
          tokenHash: record.tokenHash,
          accessLevel: record.accessLevel,
          expiresAt: record.expiresAt,
          lastSeenAt: record.lastSeenAt,
          updatedAt: record.updatedAt,
        },
      })
      .run();
    return record;
  }

  deleteSessionByTokenHash(tokenHash: string): void {
    this.client.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
  }

  deleteExpiredSessions(nowIso: string): void {
    this.client.sqlite.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso);
  }

  saveMagicLinkToken(record: StoredMagicLinkToken): StoredMagicLinkToken {
    this.client.db
      .insert(magicLinkTokens)
      .values({
        id: record.id,
        userId: record.userId,
        email: record.email,
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt,
        createdAt: record.createdAt,
        data: record,
      })
      .onConflictDoUpdate({
        target: magicLinkTokens.id,
        set: {
          userId: record.userId,
          email: record.email,
          tokenHash: record.tokenHash,
          expiresAt: record.expiresAt,
          consumedAt: record.consumedAt,
          createdAt: record.createdAt,
          data: record,
        },
      })
      .run();
    return record;
  }

  getMagicLinkTokenByHash(tokenHash: string): StoredMagicLinkToken | null {
    const row = this.client.db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, tokenHash)).get();
    return assertValue(row?.data);
  }

  consumeMagicLinkToken(tokenHash: string, consumedAt: string): StoredMagicLinkToken | null {
    const existing = this.getMagicLinkTokenByHash(tokenHash);
    if (!existing) {
      return null;
    }
    const updated: StoredMagicLinkToken = {
      ...existing,
      consumedAt,
    };
    this.client.db
      .update(magicLinkTokens)
      .set({
        consumedAt,
        data: updated,
      })
      .where(eq(magicLinkTokens.id, existing.id))
      .run();
    return updated;
  }

  pushEmailOutbox(record: EmailOutboxRecord): EmailOutboxRecord {
    this.client.db.insert(emailOutbox).values({
      id: record.id,
      userId: record.userId,
      email: record.email,
      kind: record.kind,
      createdAt: record.createdAt,
      data: record,
    }).run();
    return record;
  }

  updateEmailOutbox(record: EmailOutboxRecord): EmailOutboxRecord {
    this.client.db
      .update(emailOutbox)
      .set({
        userId: record.userId,
        email: record.email,
        kind: record.kind,
        createdAt: record.createdAt,
        data: record,
      })
      .where(eq(emailOutbox.id, record.id))
      .run();
    return record;
  }

  getLatestEmailOutbox(email: string): EmailOutboxRecord | null {
    const row = this.client.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.email, email))
      .orderBy(desc(emailOutbox.createdAt))
      .get();
    return assertValue(row?.data);
  }

  saveStoredCv(record: StoredCvFile): StoredCvFile {
    const normalizedRecord = normalizeStoredCv(record);
    this.client.db
      .insert(cvs)
      .values({
        id: normalizedRecord.id,
        userId: normalizedRecord.userId,
        fileName: normalizedRecord.fileName,
        extractedEmail: normalizedRecord.extractedEmail,
        processingStatus: normalizedRecord.processingStatus,
        uploadedAt: normalizedRecord.uploadedAt,
        updatedAt: normalizedRecord.updatedAt,
        data: normalizedRecord,
      })
      .onConflictDoUpdate({
        target: cvs.id,
        set: {
          fileName: normalizedRecord.fileName,
          extractedEmail: normalizedRecord.extractedEmail,
          processingStatus: normalizedRecord.processingStatus,
          uploadedAt: normalizedRecord.uploadedAt,
          updatedAt: normalizedRecord.updatedAt,
          data: normalizedRecord,
        },
      })
      .run();
    return normalizedRecord;
  }

  listStoredCvsByUser(userId: string): StoredCvFile[] {
    const rows = this.client.db.select().from(cvs).where(eq(cvs.userId, userId)).all();
    return [...rows
      .map((row) => row.data ? normalizeStoredCv(row.data) : null)
      .filter((value): value is StoredCvFile => Boolean(value))].sort((left, right) =>
      left.uploadedAt.localeCompare(right.uploadedAt),
    );
  }

  getStoredCvById(cvId: string): StoredCvFile | null {
    const row = this.client.db.select().from(cvs).where(eq(cvs.id, cvId)).get();
    return row?.data ? normalizeStoredCv(row.data) : null;
  }

  saveCvVersion(record: StoredCvVersion): StoredCvVersion {
    const normalizedRecord = normalizeStoredCvVersion(record);
    this.client.db
      .insert(cvVersions)
      .values({
        id: normalizedRecord.id,
        userId: normalizedRecord.userId,
        cvId: normalizedRecord.cvId,
        uploadedAt: normalizedRecord.uploadedAt,
        supersededAt: normalizedRecord.supersededAt,
        data: normalizedRecord,
      })
      .onConflictDoUpdate({
        target: cvVersions.id,
        set: {
          userId: normalizedRecord.userId,
          cvId: normalizedRecord.cvId,
          uploadedAt: normalizedRecord.uploadedAt,
          supersededAt: normalizedRecord.supersededAt,
          data: normalizedRecord,
        },
      })
      .run();
    return normalizedRecord;
  }

  getCvVersionById(versionId: string): StoredCvVersion | null {
    const row = this.client.db.select().from(cvVersions).where(eq(cvVersions.id, versionId)).get();
    return row?.data ? normalizeStoredCvVersion(row.data) : null;
  }

  listCvVersionsByCvId(cvId: string): StoredCvVersion[] {
    const rows = this.client.db
      .select()
      .from(cvVersions)
      .where(eq(cvVersions.cvId, cvId))
      .orderBy(desc(cvVersions.uploadedAt))
      .all();
    return rows
      .map((row) => row.data ? normalizeStoredCvVersion(row.data) : null)
      .filter((value): value is StoredCvVersion => Boolean(value));
  }

  saveCvProfile(profile: CVProfile): CVProfile {
    this.client.db
      .insert(cvProfiles)
      .values({
        id: profile.id,
        userId: profile.userId,
        cvId: profile.cvId,
        updatedAt: profile.updatedAt,
        data: profile,
      })
      .onConflictDoUpdate({
        target: cvProfiles.id,
        set: {
          userId: profile.userId,
          cvId: profile.cvId,
          updatedAt: profile.updatedAt,
          data: profile,
        },
      })
      .run();
    return profile;
  }

  getCvProfileByCvId(cvId: string): CVProfile | null {
    const row = this.client.db.select().from(cvProfiles).where(eq(cvProfiles.cvId, cvId)).get();
    return assertValue(row?.data);
  }

  listCvProfilesByUser(userId: string): CVProfile[] {
    const rows = this.client.db.select().from(cvProfiles).where(eq(cvProfiles.userId, userId)).all();
    return sortByUpdatedAtDescending(
      rows
        .map((row) => row.data)
        .filter((value): value is CVProfile => Boolean(value)),
    );
  }

  savePreferenceProfile(profile: PreferenceProfile): PreferenceProfile {
    this.client.db
      .insert(preferenceProfiles)
      .values({
        id: profile.id,
        userId: profile.userId,
        updatedAt: profile.updatedAt,
        data: profile,
      })
      .onConflictDoUpdate({
        target: preferenceProfiles.userId,
        set: {
          id: profile.id,
          updatedAt: profile.updatedAt,
          data: profile,
        },
      })
      .run();
    return profile;
  }

  getPreferenceProfileByUser(userId: string): PreferenceProfile | null {
    const row = this.client.db.select().from(preferenceProfiles).where(eq(preferenceProfiles.userId, userId)).get();
    return assertValue(row?.data);
  }

  saveJob(input: SaveJobInput): Job {
    this.client.db
      .insert(jobs)
      .values({
        id: input.job.id,
        userId: input.job.userId,
        sourceIdentifier: input.job.sourceIdentifier,
        sourceUrl: input.job.sourceUrl,
        sourceUrlKey: input.sourceUrlKey,
        probableDuplicateKey: input.probableDuplicateKey,
        jobExtractionState: input.job.jobExtractionState,
        extractionConfidence: Math.round(input.job.extractionConfidence * 1000),
        createdAt: input.job.createdAt,
        updatedAt: input.job.updatedAt,
        data: input.job,
      })
      .onConflictDoUpdate({
        target: jobs.id,
        set: {
          sourceIdentifier: input.job.sourceIdentifier,
          sourceUrl: input.job.sourceUrl,
          sourceUrlKey: input.sourceUrlKey,
          probableDuplicateKey: input.probableDuplicateKey,
          jobExtractionState: input.job.jobExtractionState,
          extractionConfidence: Math.round(input.job.extractionConfidence * 1000),
          updatedAt: input.job.updatedAt,
          data: input.job,
        },
      })
      .run();
    return input.job;
  }

  getJobById(jobId: string): Job | null {
    const row = this.client.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    return assertValue(row?.data);
  }

  findJobByExactSourceUrl(userId: string, sourceUrlKey: string): Job | null {
    const row = this.client.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.sourceUrlKey, sourceUrlKey)))
      .orderBy(desc(jobs.updatedAt))
      .get();
    return assertValue(row?.data);
  }

  findProbableDuplicateJobs(userId: string, probableDuplicateKey: string, excludeJobId?: string): Job[] {
    const predicate = excludeJobId
      ? and(eq(jobs.userId, userId), eq(jobs.probableDuplicateKey, probableDuplicateKey), ne(jobs.id, excludeJobId))
      : and(eq(jobs.userId, userId), eq(jobs.probableDuplicateKey, probableDuplicateKey));
    const rows = this.client.db.select().from(jobs).where(predicate).all();
    return rows.map((row) => row.data).filter((value): value is Job => Boolean(value));
  }

  saveJobExtraction(record: JobExtractionRecord): JobExtractionRecord {
    const normalizedRecord = normalizeJobExtractionRecord(record);
    this.client.db
      .insert(jobExtractions)
      .values({
        id: normalizedRecord.id,
        userId: normalizedRecord.userId,
        jobId: normalizedRecord.jobId,
        sourceIdentifier: normalizedRecord.extraction.sourceIdentifier,
        sourceUrl: normalizedRecord.extraction.sourceUrl,
        createdAt: normalizedRecord.createdAt,
        updatedAt: normalizedRecord.updatedAt,
        data: normalizedRecord,
      })
      .onConflictDoUpdate({
        target: jobExtractions.jobId,
        set: {
          sourceIdentifier: normalizedRecord.extraction.sourceIdentifier,
          sourceUrl: normalizedRecord.extraction.sourceUrl,
          updatedAt: normalizedRecord.updatedAt,
          data: normalizedRecord,
        },
      })
      .run();
    return normalizedRecord;
  }

  getJobExtractionByJobId(jobId: string): JobExtractionRecord | null {
    const row = this.client.db.select().from(jobExtractions).where(eq(jobExtractions.jobId, jobId)).get();
    return row?.data ? normalizeJobExtractionRecord(row.data) : null;
  }

  saveAiArtifact(record: StoredAiArtifact): StoredAiArtifact {
    const normalizedRecord = normalizeAiArtifact(record);
    this.client.db
      .insert(aiArtifacts)
      .values({
        id: normalizedRecord.id,
        userId: normalizedRecord.userId,
        relatedEntityType: normalizedRecord.relatedEntityType,
        relatedEntityId: normalizedRecord.relatedEntityId,
        stepType: normalizedRecord.stepType,
        status: normalizedRecord.status,
        provider: normalizedRecord.provider,
        model: normalizedRecord.model,
        promptVersion: normalizedRecord.promptVersion,
        inputHash: normalizedRecord.inputHash,
        cacheKey: normalizedRecord.cacheKey,
        createdAt: normalizedRecord.createdAt,
        updatedAt: normalizedRecord.updatedAt,
        data: normalizedRecord,
      })
      .onConflictDoUpdate({
        target: aiArtifacts.id,
        set: {
          userId: normalizedRecord.userId,
          relatedEntityType: normalizedRecord.relatedEntityType,
          relatedEntityId: normalizedRecord.relatedEntityId,
          stepType: normalizedRecord.stepType,
          status: normalizedRecord.status,
          provider: normalizedRecord.provider,
          model: normalizedRecord.model,
          promptVersion: normalizedRecord.promptVersion,
          inputHash: normalizedRecord.inputHash,
          cacheKey: normalizedRecord.cacheKey,
          updatedAt: normalizedRecord.updatedAt,
          data: normalizedRecord,
        },
      })
      .run();
    return normalizedRecord;
  }

  getAiArtifactByCacheKey(cacheKey: string): StoredAiArtifact | null {
    const row = this.client.db.select().from(aiArtifacts).where(eq(aiArtifacts.cacheKey, cacheKey)).get();
    return row?.data ? normalizeAiArtifact(row.data) : null;
  }

  listAiArtifactsByEntity(relatedEntityType: AiArtifact['relatedEntityType'], relatedEntityId: string): StoredAiArtifact[] {
    const rows = this.client.db
      .select()
      .from(aiArtifacts)
      .where(and(eq(aiArtifacts.relatedEntityType, relatedEntityType), eq(aiArtifacts.relatedEntityId, relatedEntityId)))
      .orderBy(desc(aiArtifacts.createdAt))
      .all();
    return rows
      .map((row) => row.data)
      .filter((value): value is StoredAiArtifact => Boolean(value))
      .map((value) => normalizeAiArtifact(value));
  }

  getAiArtifactsByIds(ids: string[]): StoredAiArtifact[] {
    if (ids.length === 0) {
      return [];
    }

    const idSet = new Set(ids);
    return this.client.db
      .select()
      .from(aiArtifacts)
      .all()
      .map((row) => row.data)
      .filter((value): value is StoredAiArtifact => Boolean(value) && idSet.has(value.id))
      .map((value) => normalizeAiArtifact(value))
      .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
  }

  private deactivateEvaluationsForJob(jobId: string, updatedAt: string): void {
    const rows = this.client.db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.jobId, jobId), eq(evaluations.active, true)))
      .all();
    for (const row of rows) {
      const data = row.data;
      if (!data) {
        continue;
      }
      const inactive: EvaluationResult = {
        ...normalizeEvaluationResult(data),
        active: false,
        updatedAt,
      };
      this.client.db
        .update(evaluations)
        .set({
          active: false,
          updatedAt,
          data: inactive,
        })
        .where(eq(evaluations.id, row.id))
        .run();
    }
  }

  saveEvaluation(userId: string, evaluation: EvaluationResult): EvaluationResult {
    const normalizedEvaluation = normalizeEvaluationResult(evaluation);
    this.deactivateEvaluationsForJob(normalizedEvaluation.jobId, normalizedEvaluation.updatedAt);
    this.client.db
      .insert(evaluations)
      .values({
        id: normalizedEvaluation.id,
        userId,
        jobId: normalizedEvaluation.jobId,
        active: normalizedEvaluation.active,
        evaluationVersion: normalizedEvaluation.evaluationVersion,
        scoringVersion: normalizedEvaluation.scoringVersion,
        createdAt: normalizedEvaluation.createdAt,
        updatedAt: normalizedEvaluation.updatedAt,
        data: normalizedEvaluation,
      })
      .onConflictDoUpdate({
        target: evaluations.id,
        set: {
          userId,
          jobId: normalizedEvaluation.jobId,
          active: normalizedEvaluation.active,
          evaluationVersion: normalizedEvaluation.evaluationVersion,
          scoringVersion: normalizedEvaluation.scoringVersion,
          updatedAt: normalizedEvaluation.updatedAt,
          data: normalizedEvaluation,
        },
      })
      .run();
    return normalizedEvaluation;
  }

  getEvaluationById(evaluationId: string): EvaluationResult | null {
    const row = this.client.db.select().from(evaluations).where(eq(evaluations.id, evaluationId)).get();
    return row?.data ? normalizeEvaluationResult(row.data) : null;
  }

  getActiveEvaluationByJobId(jobId: string): EvaluationResult | null {
    const row = this.client.db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.jobId, jobId), eq(evaluations.active, true)))
      .orderBy(desc(evaluations.createdAt))
      .get();
    return row?.data ? normalizeEvaluationResult(row.data) : null;
  }

  listEvaluationsByJobId(jobId: string): EvaluationResult[] {
    const rows = this.client.db
      .select()
      .from(evaluations)
      .where(eq(evaluations.jobId, jobId))
      .orderBy(desc(evaluations.createdAt))
      .all();
    return rows
      .map((row) => row.data)
      .filter((value): value is EvaluationResult => Boolean(value))
      .map((value) => normalizeEvaluationResult(value));
  }

  countEvaluationsForUserOnDay(userId: string, dayPrefix: string): number {
    const rows = this.client.db.select().from(evaluations).where(eq(evaluations.userId, userId)).all();
    return rows.filter((row) => row.createdAt.startsWith(dayPrefix)).length;
  }

  saveTrackerItem(item: TrackerItem): TrackerItem {
    const normalizedItem = normalizeTrackerItem(item);
    this.client.db
      .insert(trackerItems)
      .values({
        id: normalizedItem.id,
        userId: normalizedItem.userId,
        jobId: normalizedItem.jobId,
        currentStatus: normalizedItem.currentStatus,
        recommendedCvDecision: normalizedItem.recommendedCvDecision,
        verdictDecision: normalizedItem.verdictDecision,
        selectedCvId: normalizedItem.userSelectedCvId,
        nextActionCode: normalizedItem.nextActionSnapshot?.code ?? null,
        activeEvaluationId: normalizedItem.activeEvaluationId,
        createdAt: normalizedItem.createdAt,
        updatedAt: normalizedItem.updatedAt,
        data: normalizedItem,
      })
      .onConflictDoUpdate({
        target: trackerItems.jobId,
        set: {
          id: normalizedItem.id,
          userId: normalizedItem.userId,
          currentStatus: normalizedItem.currentStatus,
          recommendedCvDecision: normalizedItem.recommendedCvDecision,
          verdictDecision: normalizedItem.verdictDecision,
          selectedCvId: normalizedItem.userSelectedCvId,
          nextActionCode: normalizedItem.nextActionSnapshot?.code ?? null,
          activeEvaluationId: normalizedItem.activeEvaluationId,
          updatedAt: normalizedItem.updatedAt,
          data: normalizedItem,
        },
      })
      .run();
    return normalizedItem;
  }

  getTrackerItemByJobId(jobId: string): TrackerItem | null {
    const row = this.client.db.select().from(trackerItems).where(eq(trackerItems.jobId, jobId)).get();
    return row?.data ? normalizeTrackerItem(row.data) : null;
  }

  getSetupStateForUser(userId: string): SetupStateRecord | null {
    const user = this.getUserById(userId);
    if (!user) {
      return null;
    }
    return {
      user,
      cvs: this.listStoredCvsByUser(userId),
      cvProfiles: this.listCvProfilesByUser(userId),
      preferenceProfile: this.getPreferenceProfileByUser(userId),
    };
  }

  listTrackerDetailsByUser(userId: string): TrackerDetailRecord[] {
    const rows = this.client.db
      .select()
      .from(trackerItems)
      .where(eq(trackerItems.userId, userId))
      .orderBy(desc(trackerItems.updatedAt))
      .all();
    const availableCvs = this.listCvProfilesByUser(userId).map((profile) => ({
      cvId: profile.cvId,
      cvName: profile.cvName,
    }));
    return rows.map((row) => {
      const trackerItem = row.data ? normalizeTrackerItem(row.data) : null;
      const job = trackerItem ? this.getJobById(trackerItem.jobId) : null;
      const evaluation = trackerItem?.activeEvaluationId
        ? this.getEvaluationById(trackerItem.activeEvaluationId)
        : trackerItem
          ? this.getActiveEvaluationByJobId(trackerItem.jobId)
          : null;
      const extractionRecord = trackerItem ? this.getJobExtractionByJobId(trackerItem.jobId) : null;
      const probableDuplicates = trackerItem
        ? trackerItem.probableDuplicateJobIds
          .map((jobId) => {
            const probableDuplicateJob = this.getJobById(jobId);
            if (!probableDuplicateJob) {
              return null;
            }
            return {
              jobId,
              title: probableDuplicateJob.normalizedJobObject.title,
              company: probableDuplicateJob.normalizedJobObject.company,
              currentStatus: this.getTrackerItemByJobId(jobId)?.currentStatus ?? null,
            };
          })
          .filter((value): value is NonNullable<typeof value> => Boolean(value))
        : [];
      return {
        trackerItem,
        job,
        evaluation,
        validation: extractionRecord?.validation ?? null,
        extractionMeta: buildExtractionMeta(extractionRecord),
        historicalEvaluations: trackerItem
          ? this.listEvaluationsByJobId(trackerItem.jobId).filter((candidate) => candidate.id !== evaluation?.id)
          : [],
        availableCvs,
        probableDuplicates,
      };
    });
  }

  getTrackerDetailByJobId(jobId: string): TrackerDetailRecord {
    const trackerItem = this.getTrackerItemByJobId(jobId);
    const job = this.getJobById(jobId);
    const evaluation = trackerItem?.activeEvaluationId
      ? this.getEvaluationById(trackerItem.activeEvaluationId)
      : this.getActiveEvaluationByJobId(jobId);
    const extractionRecord = this.getJobExtractionByJobId(jobId);
    const validation = extractionRecord?.validation ?? null;
    const availableCvs = job ? this.listCvProfilesByUser(job.userId).map((profile) => ({
      cvId: profile.cvId,
      cvName: profile.cvName,
    })) : [];
    const probableDuplicates = trackerItem
      ? trackerItem.probableDuplicateJobIds
        .map((duplicateJobId) => {
          const duplicateJob = this.getJobById(duplicateJobId);
          if (!duplicateJob) {
            return null;
          }
          return {
            jobId: duplicateJobId,
            title: duplicateJob.normalizedJobObject.title,
            company: duplicateJob.normalizedJobObject.company,
            currentStatus: this.getTrackerItemByJobId(duplicateJobId)?.currentStatus ?? null,
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
      : [];
    return {
      trackerItem,
      job,
      evaluation,
      validation,
      extractionMeta: buildExtractionMeta(extractionRecord),
      historicalEvaluations: trackerItem
        ? this.listEvaluationsByJobId(jobId).filter((candidate) => candidate.id !== evaluation?.id)
        : [],
      availableCvs,
      probableDuplicates,
    };
  }

  recordAnalyticsEvent(event: AnalyticsEventRecord): AnalyticsEventRecord {
    this.client.db.insert(analyticsEvents).values({
      id: event.id,
      userId: event.userId,
      name: event.name,
      timestamp: event.timestamp,
      data: event,
    }).run();
    return event;
  }

  listAnalyticsEvents(userId?: string): AnalyticsEventRecord[] {
    const rows = userId
      ? this.client.db.select().from(analyticsEvents).where(eq(analyticsEvents.userId, userId)).orderBy(desc(analyticsEvents.timestamp)).all()
      : this.client.db.select().from(analyticsEvents).orderBy(desc(analyticsEvents.timestamp)).all();
    return rows.map((row) => row.data).filter((value): value is AnalyticsEventRecord => Boolean(value));
  }

  saveEyeSession(record: EyeSessionRecord): EyeSessionRecord {
    const normalizedRecord = normalizeEyeSession(record);
    this.client.db
      .insert(eyeSessions)
      .values({
        id: normalizedRecord.id,
        operatorUserId: normalizedRecord.operatorUserId,
        status: normalizedRecord.status,
        startedAt: normalizedRecord.startedAt,
        endedAt: normalizedRecord.endedAt,
        lastEventAt: normalizedRecord.lastEventAt,
        updatedAt: normalizedRecord.updatedAt,
        data: normalizedRecord,
      })
      .onConflictDoUpdate({
        target: eyeSessions.id,
        set: {
          operatorUserId: normalizedRecord.operatorUserId,
          status: normalizedRecord.status,
          startedAt: normalizedRecord.startedAt,
          endedAt: normalizedRecord.endedAt,
          lastEventAt: normalizedRecord.lastEventAt,
          updatedAt: normalizedRecord.updatedAt,
          data: normalizedRecord,
        },
      })
      .run();
    return normalizedRecord;
  }

  getEyeSessionById(sessionId: string): EyeSessionRecord | null {
    const row = this.client.db.select().from(eyeSessions).where(eq(eyeSessions.id, sessionId)).get();
    return row?.data ? normalizeEyeSession(row.data) : null;
  }

  getActiveEyeSessionByOperatorUserId(operatorUserId: string): EyeSessionRecord | null {
    const row = this.client.db
      .select()
      .from(eyeSessions)
      .where(and(eq(eyeSessions.operatorUserId, operatorUserId), eq(eyeSessions.status, 'active')))
      .orderBy(desc(eyeSessions.updatedAt))
      .get();
    return row?.data ? normalizeEyeSession(row.data) : null;
  }

  listEyeSessionsByOperatorUserId(operatorUserId: string): EyeSessionRecord[] {
    const rows = this.client.db
      .select()
      .from(eyeSessions)
      .where(eq(eyeSessions.operatorUserId, operatorUserId))
      .orderBy(desc(eyeSessions.updatedAt))
      .all();
    return rows
      .map((row) => row.data)
      .filter((value): value is EyeSessionRecord => Boolean(value))
      .map((value) => normalizeEyeSession(value));
  }

  stopActiveEyeSessionsForOperator(operatorUserId: string, endedAt: string): EyeSessionRecord[] {
    const activeSessions = this.listEyeSessionsByOperatorUserId(operatorUserId).filter((session) => session.status === 'active');
    return activeSessions.map((session) => {
      const updated: EyeSessionRecord = {
        ...session,
        status: 'stopped',
        endedAt,
        updatedAt: endedAt,
      };
      return this.saveEyeSession(updated);
    });
  }

  touchEyeSession(sessionId: string, updatedAt: string, metadata: Partial<Pick<EyeSession, 'lastEventAt' | 'webAppVersion' | 'extensionVersion'>> = {}): EyeSessionRecord | null {
    const existing = this.getEyeSessionById(sessionId);
    if (!existing) {
      return null;
    }
    const updated: EyeSessionRecord = {
      ...existing,
      lastEventAt: metadata.lastEventAt ?? existing.lastEventAt,
      webAppVersion: metadata.webAppVersion ?? existing.webAppVersion,
      extensionVersion: metadata.extensionVersion ?? existing.extensionVersion,
      updatedAt,
    };
    return this.saveEyeSession(updated);
  }

  pruneEyeSessionsOlderThan(cutoffIso: string): void {
    this.client.sqlite.prepare(`
      DELETE FROM eye_sessions
      WHERE status = 'stopped'
        AND COALESCE(ended_at, updated_at) < ?
    `).run(cutoffIso);
  }

  saveDiagnosticEvent(event: DiagnosticEventRecord): DiagnosticEventRecord {
    const normalizedEvent = normalizeDiagnosticEvent(event);
    this.client.db.insert(diagnosticEvents).values({
      id: normalizedEvent.id,
      eyeSessionId: normalizedEvent.eyeSessionId,
      requestId: normalizedEvent.requestId,
      userId: normalizedEvent.userId,
      jobId: normalizedEvent.jobId,
      trackerItemId: normalizedEvent.trackerItemId,
      area: normalizedEvent.area,
      severity: normalizedEvent.severity,
      createdAt: normalizedEvent.createdAt,
      data: normalizedEvent,
    }).run();
    if (normalizedEvent.eyeSessionId) {
      this.touchEyeSession(normalizedEvent.eyeSessionId, normalizedEvent.createdAt, { lastEventAt: normalizedEvent.createdAt });
    }
    return normalizedEvent;
  }

  getDiagnosticEventById(eventId: string): DiagnosticEventRecord | null {
    const row = this.client.db.select().from(diagnosticEvents).where(eq(diagnosticEvents.id, eventId)).get();
    return row?.data ? normalizeDiagnosticEvent(row.data) : null;
  }

  listDiagnosticEvents(filters: {
    eyeSessionId?: string | null;
    requestId?: string | null;
    userId?: string | null;
    jobId?: string | null;
    area?: DiagnosticEvent['area'] | null;
    severity?: DiagnosticEvent['severity'] | null;
    sinceIso?: string | null;
    limit?: number | null;
  } = {}): DiagnosticEventRecord[] {
    const rows = this.client.db.select().from(diagnosticEvents).orderBy(desc(diagnosticEvents.createdAt)).all();
    const filtered = rows
      .map((row) => row.data)
      .filter((value): value is DiagnosticEventRecord => Boolean(value))
      .map((value) => normalizeDiagnosticEvent(value))
      .filter((event) => !filters.eyeSessionId || event.eyeSessionId === filters.eyeSessionId)
      .filter((event) => !filters.requestId || event.requestId === filters.requestId)
      .filter((event) => !filters.userId || event.userId === filters.userId)
      .filter((event) => !filters.jobId || event.jobId === filters.jobId)
      .filter((event) => !filters.area || event.area === filters.area)
      .filter((event) => !filters.severity || event.severity === filters.severity)
      .filter((event) => !filters.sinceIso || event.createdAt >= filters.sinceIso);
    if (typeof filters.limit === 'number' && filters.limit > 0) {
      return filtered.slice(0, filters.limit);
    }
    return filtered;
  }

  pruneDiagnosticEventsOlderThan(cutoffIso: string): void {
    this.client.sqlite.prepare('DELETE FROM diagnostic_events WHERE created_at < ?').run(cutoffIso);
  }
}
