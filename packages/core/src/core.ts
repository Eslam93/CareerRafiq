import type {
  BootstrapCurrentResponse,
  CaptureJobRequest,
  CapturePageRequest,
  CapturePageResponse,
  CaptureJobResponse,
  ExtractPageRequest,
  ExtractPageResponse,
  EvaluateJobRequest,
  EvaluateJobResponse,
  ExtractionValidationResult,
  Job,
  MagicLinkSendRequest,
  MagicLinkSendResponse,
  MagicLinkVerifyRequest,
  MagicLinkVerifyResponse,
  SetupBootstrapRequest,
  SetupBootstrapResponse,
  TrackerDetailResponse,
  TrackerItem,
  TrackerListResponse,
  TrackerStatus,
  User,
} from '@career-rafiq/contracts';
import { bootstrapWorkspace } from './bootstrap.js';
import { type AuthSessionState, InMemoryAuthSessionService } from './auth.js';
import { evaluateJob as scoreEvaluation } from './evaluation.js';
import { validateExtraction } from './extraction.js';
import { createId, nowIso } from './helpers.js';
import { createTrackerItem, patchTrackerStatus, updateTrackerFromEvaluation } from './tracker.js';
import { extractPagePayload, isSourceSupported } from './extractors/index.js';

export interface AnalyticsEventRecord {
  name: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

export interface CareerRafiqCoreState {
  user: User | null;
  bootstrap: SetupBootstrapResponse | null;
  jobs: Job[];
  validationsByJobId: Array<{
    jobId: string;
    validation: ExtractionValidationResult;
  }>;
  evaluations: Awaited<ReturnType<typeof scoreEvaluation>>[];
  trackerItems: TrackerItem[];
  analyticsEvents: AnalyticsEventRecord[];
  auth: AuthSessionState;
}

interface CoreState {
  user: User | null;
  bootstrap: SetupBootstrapResponse | null;
  jobs: Job[];
  validationsByJobId: Map<string, ReturnType<typeof validateExtraction>>;
  evaluations: Awaited<ReturnType<typeof scoreEvaluation>>[];
  trackerItemsByJobId: Map<string, TrackerItem>;
  analyticsEvents: AnalyticsEventRecord[];
}

export interface CoreOptions {
  evaluationVersion?: string;
  scoringVersion?: string;
  clock?: () => Date;
  dailyEvaluationLimit?: number;
}

export class CareerRafiqCore {
  private readonly evaluationVersion: string;

  private readonly scoringVersion: string;

  private readonly clock: () => Date;

  private readonly dailyEvaluationLimit: number;

  private authService: InMemoryAuthSessionService;

  private state: CoreState = {
    user: null,
    bootstrap: null,
    jobs: [],
    validationsByJobId: new Map(),
    evaluations: [],
    trackerItemsByJobId: new Map(),
    analyticsEvents: [],
  };

  constructor(options: CoreOptions = {}) {
    this.evaluationVersion = options.evaluationVersion ?? 'evaluation-v1';
    this.scoringVersion = options.scoringVersion ?? 'scoring-v1';
    this.clock = options.clock ?? (() => new Date());
    this.dailyEvaluationLimit = options.dailyEvaluationLimit ?? 25;
    this.authService = new InMemoryAuthSessionService(this.clock);
  }

  bootstrap(input: SetupBootstrapRequest): SetupBootstrapResponse {
    this.authService = new InMemoryAuthSessionService(this.clock);
    const bootstrap = bootstrapWorkspace(input, this.clock, this.authService);
    this.state = {
      ...this.state,
      user: bootstrap.user,
      bootstrap,
      jobs: [],
      validationsByJobId: new Map(),
      evaluations: [],
      trackerItemsByJobId: new Map(),
      analyticsEvents: [],
    };
    this.track('cv_upload_completed', { userId: bootstrap.user.id, timestamp: nowIso(this.clock) });
    if (bootstrap.magicLinkToken) {
      this.track('magic_link_sent', { userId: bootstrap.user.id, timestamp: nowIso(this.clock) });
    }
    return bootstrap;
  }

  sendMagicLink(request: MagicLinkSendRequest): MagicLinkSendResponse {
    const user = this.getUserOrThrow(request.userId);
    const response = this.authService.sendMagicLink(request);
    this.syncStateUser(request.userId);
    this.track('magic_link_sent', { userId: user.id, timestamp: nowIso(this.clock) });
    return response;
  }

  verifyMagicLink(request: MagicLinkVerifyRequest): MagicLinkVerifyResponse {
    const response = this.authService.verifyMagicLink(request);
    if (response.verified && response.userId) {
      this.syncStateUser(response.userId);
      this.track('email_verified', { userId: response.userId, timestamp: nowIso(this.clock) });
    }
    return response;
  }

  extractPage(request: ExtractPageRequest): ExtractPageResponse {
    const extractionInput = {
      sourceUrl: request.sourceUrl,
      pageContent: request.pageContent,
      ...(request.sourceIdentifier ? { sourceIdentifier: request.sourceIdentifier } : {}),
    };
    const extraction = extractPagePayload(extractionInput);
    return {
      extraction,
      supported: isSourceSupported(extraction.sourceIdentifier),
      detectedSourceIdentifier: extraction.sourceIdentifier,
    };
  }

  capturePage(request: CapturePageRequest): CapturePageResponse {
    const extracted = this.extractPage(request);
    const capture = this.captureJob({ extraction: extracted.extraction });
    return {
      ...capture,
      extraction: extracted.extraction,
      supported: extracted.supported,
      detectedSourceIdentifier: extracted.detectedSourceIdentifier,
    };
  }

  captureJob(request: CaptureJobRequest): CaptureJobResponse {
    const user = this.getUserOrThrow();
    const validation = validateExtraction(request.extraction);
    const job: Job | null =
      validation.status === 'failed' || !validation.normalizedJobObject
        ? null
        : {
            id: createId('job'),
            userId: user.id,
            sourceIdentifier: request.extraction.sourceIdentifier,
            sourceUrl: request.extraction.sourceUrl,
            rawCaptureContent: request.extraction.rawCaptureContent,
            normalizedJobObject: validation.normalizedJobObject,
            extractionConfidence: validation.extractionConfidence,
            captureSourceType: request.extraction.sourceIdentifier,
            extractionVersion: 'extraction-v1',
            jobExtractionState: validation.status === 'proceed' ? 'ready_for_evaluation' : 'review_required',
            createdAt: nowIso(this.clock),
            updatedAt: nowIso(this.clock),
          };

    if (!job) {
      this.track('job_capture_failed', { userId: user.id, sourceType: request.extraction.sourceIdentifier, timestamp: nowIso(this.clock) });
      return { validation, job: null, trackerItem: null };
    }

    this.state.jobs.push(job);
    this.state.validationsByJobId.set(job.id, validation);
    const trackerItem = createTrackerItem(job, null, this.clock);
    this.state.trackerItemsByJobId.set(job.id, trackerItem);
    this.track(validation.status === 'proceed' ? 'job_capture_succeeded' : 'job_review_required', {
      userId: user.id,
      jobId: job.id,
      sourceType: request.extraction.sourceIdentifier,
      timestamp: nowIso(this.clock),
    });

    return { validation, job, trackerItem };
  }

  evaluateJob(request: EvaluateJobRequest): EvaluateJobResponse {
    const job = this.getJobOrThrow(request.jobId);
    const user = this.getUserOrThrow(job.userId);
    if (!this.authService.canRunEvaluation(user, { dailyLimit: this.dailyEvaluationLimit })) {
      throw new Error(`Daily evaluation limit reached for verified users (${this.dailyEvaluationLimit}/day).`);
    }
    const validation = this.state.validationsByJobId.get(job.id);
    const evaluation =
      validation && validation.status === 'proceed'
        ? scoreEvaluation(
            {
              job,
              cvProfiles: this.bootstrapOrThrow().cvProfiles,
              preferenceProfile: this.bootstrapOrThrow().preferenceProfile,
              reviewGateStatus: 'proceed',
            },
            this.evaluationVersion,
            this.scoringVersion,
          )
        : scoreEvaluation(
            {
              job,
              cvProfiles: this.bootstrapOrThrow().cvProfiles,
              preferenceProfile: this.bootstrapOrThrow().preferenceProfile,
              reviewGateStatus: validation?.status ?? 'review_required',
            },
            this.evaluationVersion,
            this.scoringVersion,
          );

    this.state.evaluations.filter((candidate) => candidate.jobId === job.id && candidate.active).forEach((candidate) => {
      candidate.active = false;
      candidate.updatedAt = nowIso(this.clock);
    });
    this.state.evaluations.push(evaluation);
    this.authService.noteEvaluationCompleted(user.id, this.clock());

    const trackerItem = this.state.trackerItemsByJobId.get(job.id) ?? createTrackerItem(job, evaluation, this.clock);
    const updatedTracker = updateTrackerFromEvaluation(trackerItem, evaluation, this.clock);
    this.state.trackerItemsByJobId.set(job.id, updatedTracker);

    this.track('evaluation_completed', {
      userId: job.userId,
      jobId: job.id,
      recommendedCvId: evaluation.recommendedCvId ?? undefined,
      verdict: evaluation.verdict ?? undefined,
      timestamp: nowIso(this.clock),
    });

    return {
      evaluation,
      trackerItem: updatedTracker,
      recommendedCvName: evaluation.recommendedCvId
        ? this.state.bootstrap?.cvProfiles.find((profile) => profile.cvId === evaluation.recommendedCvId)?.cvName ?? null
        : null,
    };
  }

  updateTrackerStatus(jobId: string, status: TrackerStatus): TrackerItem {
    const trackerItem = this.getTrackerItemOrThrow(jobId);
    const activeEvaluation = trackerItem.activeEvaluationId
      ? this.state.evaluations.find((candidate) => candidate.id === trackerItem.activeEvaluationId) ?? null
      : null;
    const updated = patchTrackerStatus(trackerItem, status, activeEvaluation, this.clock);
    this.state.trackerItemsByJobId.set(jobId, updated);
    return updated;
  }

  addTrackerNote(jobId: string, note: string): TrackerItem {
    const trackerItem = this.getTrackerItemOrThrow(jobId);
    const updated: TrackerItem = {
      ...trackerItem,
      notes: trackerItem.notes ? `${trackerItem.notes}\n${note}` : note,
      updatedAt: nowIso(this.clock),
    };
    this.state.trackerItemsByJobId.set(jobId, updated);
    return updated;
  }

  getTrackerItem(jobId: string): TrackerItem | null {
    return this.state.trackerItemsByJobId.get(jobId) ?? null;
  }

  listTrackerItems(): TrackerListResponse {
    const cvNameById = new Map(
      (this.state.bootstrap?.cvProfiles ?? []).map((profile) => [profile.cvId, profile.cvName]),
    );
    return {
      items: [...this.state.trackerItemsByJobId.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((trackerItem) => {
          const evaluation = trackerItem.activeEvaluationId
            ? this.state.evaluations.find((candidate) => candidate.id === trackerItem.activeEvaluationId) ?? null
            : null;
          const recommendedCvId = evaluation?.recommendedCvId ?? trackerItem.recommendationSnapshot?.recommendedCvId ?? null;
          return {
            trackerItem,
            job: this.state.jobs.find((candidate) => candidate.id === trackerItem.jobId)!,
            evaluation,
            recommendedCvName: recommendedCvId ? cvNameById.get(recommendedCvId) ?? null : null,
            selectedCvName: trackerItem.userSelectedCvId ? cvNameById.get(trackerItem.userSelectedCvId) ?? null : null,
          };
        }),
    };
  }

  getTrackerDetail(jobId: string): TrackerDetailResponse {
    const trackerItem = this.state.trackerItemsByJobId.get(jobId) ?? null;
    const job = this.state.jobs.find((candidate) => candidate.id === jobId) ?? null;
    const evaluation = trackerItem?.activeEvaluationId
      ? this.state.evaluations.find((candidate) => candidate.id === trackerItem.activeEvaluationId) ?? null
      : null;
    const historicalEvaluations = trackerItem
      ? this.state.evaluations
        .filter((candidate) => candidate.jobId === jobId && candidate.id !== evaluation?.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      : [];
    const availableCvs = this.state.bootstrap?.cvProfiles.map((profile) => ({
      cvId: profile.cvId,
      cvName: profile.cvName,
    })) ?? [];
    const probableDuplicates = trackerItem
      ? trackerItem.probableDuplicateJobIds
        .map((duplicateJobId) => {
          const duplicateJob = this.state.jobs.find((candidate) => candidate.id === duplicateJobId);
          const duplicateTracker = this.state.trackerItemsByJobId.get(duplicateJobId) ?? null;
          if (!duplicateJob) {
            return null;
          }
          return {
            jobId: duplicateJobId,
            title: duplicateJob.normalizedJobObject.title,
            company: duplicateJob.normalizedJobObject.company,
            currentStatus: duplicateTracker?.currentStatus ?? null,
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
      : [];
    return {
      trackerItem,
      job,
      evaluation,
      validation: job ? this.state.validationsByJobId.get(job.id) ?? null : null,
      extractionMeta: null,
      historicalEvaluations,
      availableCvs,
      probableDuplicates,
    };
  }

  getBootstrapState(): BootstrapCurrentResponse {
    return {
      bootstrap: this.state.bootstrap,
    };
  }

  exportState(): CareerRafiqCoreState {
    return {
      user: this.state.user ? { ...this.state.user } : null,
      bootstrap: this.state.bootstrap ? structuredClone(this.state.bootstrap) : null,
      jobs: structuredClone(this.state.jobs),
      validationsByJobId: [...this.state.validationsByJobId.entries()].map(([jobId, validation]) => ({
        jobId,
        validation: structuredClone(validation),
      })),
      evaluations: structuredClone(this.state.evaluations),
      trackerItems: structuredClone([...this.state.trackerItemsByJobId.values()]),
      analyticsEvents: structuredClone(this.state.analyticsEvents),
      auth: this.authService.exportState(),
    };
  }

  importState(state: CareerRafiqCoreState): void {
    this.authService = new InMemoryAuthSessionService(this.clock);
    this.authService.importState(state.auth);
    this.state = {
      user: state.user ? { ...state.user } : null,
      bootstrap: state.bootstrap ? structuredClone(state.bootstrap) : null,
      jobs: structuredClone(state.jobs),
      validationsByJobId: new Map(state.validationsByJobId.map((entry) => [entry.jobId, structuredClone(entry.validation)])),
      evaluations: structuredClone(state.evaluations),
      trackerItemsByJobId: new Map(state.trackerItems.map((trackerItem) => [trackerItem.jobId, structuredClone(trackerItem)])),
      analyticsEvents: structuredClone(state.analyticsEvents),
    };
  }

  getSnapshot() {
    return {
      users: this.state.user ? 1 : 0,
      cvs: this.state.bootstrap?.cvs.length ?? 0,
      jobs: this.state.jobs.length,
      evaluations: this.state.evaluations.length,
      trackerItems: this.state.trackerItemsByJobId.size,
      analyticsEvents: this.state.analyticsEvents.length,
    };
  }

  private bootstrapOrThrow() {
    if (!this.state.bootstrap) {
      throw new Error('Bootstrap must be completed first.');
    }
    return this.state.bootstrap;
  }

  private getUserOrThrow(userId?: string): User {
    if (!this.state.user) {
      throw new Error('Call bootstrap first.');
    }
    if (userId && this.state.user.id !== userId) {
      throw new Error(`User ${userId} is not the active bootstrap user.`);
    }
    return this.state.user;
  }

  private getJobOrThrow(jobId: string): Job {
    const job = this.state.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    return job;
  }

  private getTrackerItemOrThrow(jobId: string): TrackerItem {
    const trackerItem = this.state.trackerItemsByJobId.get(jobId);
    if (!trackerItem) {
      throw new Error(`Tracker item for job ${jobId} was not found.`);
    }
    return trackerItem;
  }

  private syncStateUser(userId: string): void {
    const user = this.authService.getUser(userId);
    if (user) {
      this.state.user = user;
      if (this.state.bootstrap) {
        this.state.bootstrap.user = user;
      }
    }
  }

  private track(name: string, properties: Record<string, unknown>): void {
    this.state.analyticsEvents.push({
      name,
      timestamp: nowIso(this.clock),
      properties,
    });
  }
}
