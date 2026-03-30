import { AnalyticsEventNames } from '@career-rafiq/contracts';
import type {
  AnalyticsEventName,
  EvaluationInput,
  EvaluationResult,
  ReviewGateStatus,
  Verdict,
} from '@career-rafiq/contracts';

export interface BenchmarkCaseLike {
  id: string;
  input: EvaluationInput;
  expectedVerdict: Verdict | null;
  expectedRecommendedCvId?: string | null;
  expectedReviewGateStatus?: ReviewGateStatus;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface BenchmarkedCaseResult {
  caseId: string;
  passed: boolean;
  expectedVerdict: Verdict | null;
  actualVerdict: Verdict | null;
  expectedRecommendedCvId?: string | null;
  actualRecommendedCvId: string | null;
  expectedReviewGateStatus?: ReviewGateStatus;
  actualReviewGateStatus: ReviewGateStatus | null;
  outputShapeValid: boolean;
  issues: ValidationIssue[];
}

export interface BenchmarkRunResult {
  passed: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  caseResults: BenchmarkedCaseResult[];
}

export interface EventSchemaExpectationsResult {
  valid: boolean;
  missingCriticalEvents: AnalyticsEventName[];
  duplicateEventNames: string[];
}

const VERDICTS: ReadonlyArray<Verdict | null> = ['apply', 'consider', 'skip', null];
const REVIEW_GATE_STATUSES: ReadonlyArray<ReviewGateStatus> = ['proceed', 'review_required', 'failed'];
const CRITICAL_ANALYTICS_EVENTS: ReadonlyArray<AnalyticsEventName> = [
  'setup_minimum_ready',
  'email_verified',
  'job_capture_succeeded',
  'job_review_required',
  'evaluation_completed',
  'recommended_cv_accepted',
  'verdict_overridden',
  'tracker_opened',
  'reevaluation_completed',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validateCriterionLike(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  requiresSubcriterion: boolean,
): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return;
  }

  const item = value as {
    criterion?: unknown;
    subcriterion?: unknown;
    score?: unknown;
    maxScore?: unknown;
    note?: unknown;
  };

  if (typeof item.criterion !== 'string') {
    pushIssue(issues, `${path}.criterion`, 'must be a string');
  }
  if (requiresSubcriterion && typeof item.subcriterion !== 'string') {
    pushIssue(issues, `${path}.subcriterion`, 'must be a string');
  }
  if (typeof item.score !== 'number') {
    pushIssue(issues, `${path}.score`, 'must be a number');
  }
  if (typeof item.maxScore !== 'number') {
    pushIssue(issues, `${path}.maxScore`, 'must be a number');
  }
  if (typeof item.note !== 'string') {
    pushIssue(issues, `${path}.note`, 'must be a string');
  }
}

function validateEvaluatedCvResult(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return;
  }

  const item = value as {
    cvId?: unknown;
    totalScore?: unknown;
    hardSkipApplied?: unknown;
    note?: unknown;
    criterionScores?: unknown;
    subcriterionScores?: unknown;
    appliedPenalties?: unknown;
  };

  if (typeof item.cvId !== 'string') {
    pushIssue(issues, `${path}.cvId`, 'must be a string');
  }
  if (typeof item.totalScore !== 'number') {
    pushIssue(issues, `${path}.totalScore`, 'must be a number');
  }
  if (typeof item.hardSkipApplied !== 'boolean') {
    pushIssue(issues, `${path}.hardSkipApplied`, 'must be a boolean');
  }
  if (typeof item.note !== 'string') {
    pushIssue(issues, `${path}.note`, 'must be a string');
  }

  if (!Array.isArray(item.criterionScores)) {
    pushIssue(issues, `${path}.criterionScores`, 'must be an array');
  } else {
    item.criterionScores.forEach((entry, index) =>
      validateCriterionLike(entry, `${path}.criterionScores[${index}]`, issues, false),
    );
  }

  if (!Array.isArray(item.subcriterionScores)) {
    pushIssue(issues, `${path}.subcriterionScores`, 'must be an array');
  } else {
    item.subcriterionScores.forEach((entry, index) =>
      validateCriterionLike(entry, `${path}.subcriterionScores[${index}]`, issues, true),
    );
  }

  if (!Array.isArray(item.appliedPenalties)) {
    pushIssue(issues, `${path}.appliedPenalties`, 'must be an array');
  } else {
    item.appliedPenalties.forEach((entry, index) => {
      if (!isRecord(entry)) {
        pushIssue(issues, `${path}.appliedPenalties[${index}]`, 'must be an object');
        return;
      }
      const penalty = entry as {
        code?: unknown;
        label?: unknown;
        severity?: unknown;
        impact?: unknown;
        reason?: unknown;
      };
      if (typeof penalty.code !== 'string') {
        pushIssue(issues, `${path}.appliedPenalties[${index}].code`, 'must be a string');
      }
      if (typeof penalty.label !== 'string') {
        pushIssue(issues, `${path}.appliedPenalties[${index}].label`, 'must be a string');
      }
      if (typeof penalty.severity !== 'number') {
        pushIssue(issues, `${path}.appliedPenalties[${index}].severity`, 'must be a number');
      }
      if (typeof penalty.impact !== 'number') {
        pushIssue(issues, `${path}.appliedPenalties[${index}].impact`, 'must be a number');
      }
      if (typeof penalty.reason !== 'string') {
        pushIssue(issues, `${path}.appliedPenalties[${index}].reason`, 'must be a string');
      }
    });
  }
}

export function validateEvaluationResultShape(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const rootPath = 'evaluationResult';

  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: rootPath, message: 'must be an object' }],
    };
  }

  const result = value as Partial<EvaluationResult> & Record<string, unknown>;

  if (typeof result.id !== 'string') {
    pushIssue(issues, `${rootPath}.id`, 'must be a string');
  }
  if (typeof result.jobId !== 'string') {
    pushIssue(issues, `${rootPath}.jobId`, 'must be a string');
  }
  if (!Array.isArray(result.evaluatedCvResults)) {
    pushIssue(issues, `${rootPath}.evaluatedCvResults`, 'must be an array');
  } else {
    result.evaluatedCvResults.forEach((entry, index) =>
      validateEvaluatedCvResult(entry, `${rootPath}.evaluatedCvResults[${index}]`, issues),
    );
  }

  if (!(typeof result.recommendedCvId === 'string' || result.recommendedCvId === null)) {
    pushIssue(issues, `${rootPath}.recommendedCvId`, 'must be a string or null');
  }
  if (!VERDICTS.includes(result.verdict as Verdict | null)) {
    pushIssue(issues, `${rootPath}.verdict`, 'must be apply | consider | skip | null');
  }
  if (!(typeof result.totalScore === 'number' || result.totalScore === null)) {
    pushIssue(issues, `${rootPath}.totalScore`, 'must be a number or null');
  }
  if (!Array.isArray(result.criterionScores)) {
    pushIssue(issues, `${rootPath}.criterionScores`, 'must be an array');
  }
  if (!Array.isArray(result.subcriterionScores)) {
    pushIssue(issues, `${rootPath}.subcriterionScores`, 'must be an array');
  }
  if (!Array.isArray(result.appliedPenalties)) {
    pushIssue(issues, `${rootPath}.appliedPenalties`, 'must be an array');
  }
  if (typeof result.hardSkipApplied !== 'boolean') {
    pushIssue(issues, `${rootPath}.hardSkipApplied`, 'must be a boolean');
  }
  if (!REVIEW_GATE_STATUSES.includes(result.reviewGateStatus as ReviewGateStatus)) {
    pushIssue(issues, `${rootPath}.reviewGateStatus`, 'must be proceed | review_required | failed');
  }
  if (typeof result.evaluationVersion !== 'string') {
    pushIssue(issues, `${rootPath}.evaluationVersion`, 'must be a string');
  }
  if (typeof result.scoringVersion !== 'string') {
    pushIssue(issues, `${rootPath}.scoringVersion`, 'must be a string');
  }

  if (!isRecord(result.explanationEvidencePayload)) {
    pushIssue(issues, `${rootPath}.explanationEvidencePayload`, 'must be an object');
  } else {
    if (!isStringArray(result.explanationEvidencePayload.matchedSignals)) {
      pushIssue(issues, `${rootPath}.explanationEvidencePayload.matchedSignals`, 'must be string[]');
    }
    if (!isStringArray(result.explanationEvidencePayload.gapSignals)) {
      pushIssue(issues, `${rootPath}.explanationEvidencePayload.gapSignals`, 'must be string[]');
    }
    if (!isStringArray(result.explanationEvidencePayload.hardSkipReasons)) {
      pushIssue(issues, `${rootPath}.explanationEvidencePayload.hardSkipReasons`, 'must be string[]');
    }
    if (!isStringArray(result.explanationEvidencePayload.recommendationReasons)) {
      pushIssue(
        issues,
        `${rootPath}.explanationEvidencePayload.recommendationReasons`,
        'must be string[]',
      );
    }
  }

  if (typeof result.conciseExplanation !== 'string') {
    pushIssue(issues, `${rootPath}.conciseExplanation`, 'must be a string');
  }
  if (!isStringArray(result.majorGapsSummary)) {
    pushIssue(issues, `${rootPath}.majorGapsSummary`, 'must be string[]');
  }
  if (typeof result.detailedExplanation !== 'string') {
    pushIssue(issues, `${rootPath}.detailedExplanation`, 'must be a string');
  }
  if (!isStringArray(result.suggestedCvChanges)) {
    pushIssue(issues, `${rootPath}.suggestedCvChanges`, 'must be string[]');
  }
  if (typeof result.active !== 'boolean') {
    pushIssue(issues, `${rootPath}.active`, 'must be a boolean');
  }
  if (typeof result.createdAt !== 'string') {
    pushIssue(issues, `${rootPath}.createdAt`, 'must be a string');
  }
  if (typeof result.updatedAt !== 'string') {
    pushIssue(issues, `${rootPath}.updatedAt`, 'must be a string');
  }

  return { valid: issues.length === 0, issues };
}

export function validateAnalyticsEventSchemaExpectations(): EventSchemaExpectationsResult {
  const seen = new Set<string>();
  const duplicateEventNames: string[] = [];

  for (const eventName of AnalyticsEventNames) {
    if (seen.has(eventName)) {
      duplicateEventNames.push(eventName);
      continue;
    }
    seen.add(eventName);
  }

  const missingCriticalEvents = CRITICAL_ANALYTICS_EVENTS.filter((eventName) => !seen.has(eventName));

  return {
    valid: duplicateEventNames.length === 0 && missingCriticalEvents.length === 0,
    duplicateEventNames,
    missingCriticalEvents,
  };
}

export function validateAnalyticsEvent(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const path = 'analyticsEvent';

  if (!isRecord(value)) {
    return { valid: false, issues: [{ path, message: 'must be an object' }] };
  }

  const event = value as {
    name?: unknown;
    timestamp?: unknown;
    properties?: unknown;
  };

  if (typeof event.name !== 'string' || !AnalyticsEventNames.includes(event.name as AnalyticsEventName)) {
    pushIssue(issues, `${path}.name`, 'must be a known analytics event name');
  }

  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
    pushIssue(issues, `${path}.timestamp`, 'must be an ISO date-time string');
  }

  if (!isRecord(event.properties)) {
    pushIssue(issues, `${path}.properties`, 'must be an object');
  } else {
    const properties = event.properties as {
      userId?: unknown;
      cvId?: unknown;
      jobId?: unknown;
      trackerItemId?: unknown;
      sourceType?: unknown;
      sourceDomain?: unknown;
      captureMethod?: unknown;
      extractionConfidenceBand?: unknown;
      evaluationVersion?: unknown;
      recommendedCvId?: unknown;
      reviewRequiredFlag?: unknown;
      overrideFlag?: unknown;
      verdict?: unknown;
    };

    const stringProps = [
      'userId',
      'cvId',
      'jobId',
      'trackerItemId',
      'sourceType',
      'sourceDomain',
      'captureMethod',
      'extractionConfidenceBand',
      'evaluationVersion',
      'recommendedCvId',
    ] as const;

    stringProps.forEach((propertyName) => {
      const propertyValue = properties[propertyName];
      if (propertyValue !== undefined && typeof propertyValue !== 'string') {
        pushIssue(issues, `${path}.properties.${propertyName}`, 'must be a string when present');
      }
    });

    if (properties.reviewRequiredFlag !== undefined && typeof properties.reviewRequiredFlag !== 'boolean') {
      pushIssue(issues, `${path}.properties.reviewRequiredFlag`, 'must be a boolean when present');
    }

    if (properties.overrideFlag !== undefined && typeof properties.overrideFlag !== 'boolean') {
      pushIssue(issues, `${path}.properties.overrideFlag`, 'must be a boolean when present');
    }

    if (properties.verdict !== undefined && !(typeof properties.verdict === 'string' || properties.verdict === null)) {
      pushIssue(issues, `${path}.properties.verdict`, 'must be a string or null when present');
    }
  }

  return { valid: issues.length === 0, issues };
}

export type EvaluateCaseFn = (input: EvaluationInput, benchmarkCaseId: string) => unknown | Promise<unknown>;

export async function runBenchmarkCases(
  cases: readonly BenchmarkCaseLike[],
  evaluateCase: EvaluateCaseFn,
): Promise<BenchmarkRunResult> {
  const caseResults: BenchmarkedCaseResult[] = [];

  for (const benchmarkCase of cases) {
    const output = await evaluateCase(benchmarkCase.input, benchmarkCase.id);
    const shapeValidation = validateEvaluationResultShape(output);
    const outputRecord = isRecord(output) ? (output as { verdict?: unknown; recommendedCvId?: unknown; reviewGateStatus?: unknown }) : null;
    const actualVerdict =
      shapeValidation.valid && outputRecord
        ? ((outputRecord.verdict as Verdict | null | undefined) ?? null)
        : null;
    const actualRecommendedCvId =
      shapeValidation.valid && outputRecord
        ? ((outputRecord.recommendedCvId as string | null | undefined) ?? null)
        : null;
    const actualReviewGateStatus =
      shapeValidation.valid && outputRecord && typeof outputRecord.reviewGateStatus === 'string'
        ? (outputRecord.reviewGateStatus as ReviewGateStatus)
        : null;
    const verdictMatches = actualVerdict === benchmarkCase.expectedVerdict;
    const recommendedCvMatches =
      benchmarkCase.expectedRecommendedCvId === undefined || actualRecommendedCvId === benchmarkCase.expectedRecommendedCvId;
    const reviewGateMatches =
      benchmarkCase.expectedReviewGateStatus === undefined || actualReviewGateStatus === benchmarkCase.expectedReviewGateStatus;

    caseResults.push({
      caseId: benchmarkCase.id,
      passed: shapeValidation.valid && verdictMatches && recommendedCvMatches && reviewGateMatches,
      expectedVerdict: benchmarkCase.expectedVerdict,
      actualVerdict,
      actualRecommendedCvId,
      actualReviewGateStatus,
      outputShapeValid: shapeValidation.valid,
      issues: shapeValidation.issues,
      ...(benchmarkCase.expectedRecommendedCvId !== undefined
        ? { expectedRecommendedCvId: benchmarkCase.expectedRecommendedCvId }
        : {}),
      ...(benchmarkCase.expectedReviewGateStatus !== undefined
        ? { expectedReviewGateStatus: benchmarkCase.expectedReviewGateStatus }
        : {}),
    });
  }

  const passedCases = caseResults.filter((result) => result.passed).length;
  const totalCases = caseResults.length;

  return {
    passed: passedCases === totalCases,
    totalCases,
    passedCases,
    failedCases: totalCases - passedCases,
    caseResults,
  };
}
