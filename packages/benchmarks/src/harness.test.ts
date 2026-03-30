import { describe, expect, it } from 'vitest';
import type { AnalyticsEvent, EvaluationInput, EvaluationResult } from '@career-rafiq/contracts';
import type { BenchmarkCase } from './index.js';
import { benchmarkCases } from './index.js';
import {
  runBenchmarkCases,
  validateAnalyticsEvent,
  validateAnalyticsEventSchemaExpectations,
  validateEvaluationResultShape,
} from './harness.js';

function buildDefaultNormalizedComparisonDescriptors() {
  return {
    version: 'eval-normalization-v2',
    job: {
      titleTokens: [],
      roleTrack: null,
      seniority: 'unknown' as const,
      locationTokens: [],
      workSetup: 'unknown' as const,
      employmentType: 'unknown' as const,
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
  };
}

function buildDefaultDecisionTrace(reviewGateStatus: EvaluationResult['reviewGateStatus']): EvaluationResult['decisionTrace'] {
  return {
    pipelineSteps: [
      { name: 'normalize_inputs', status: 'completed', note: 'Benchmark fixture normalization completed.' },
      { name: 'validate_inputs', status: 'completed', note: 'Benchmark fixture validation completed.' },
      { name: 'review_gate', status: reviewGateStatus === 'proceed' ? 'skipped' : 'completed', note: 'Benchmark fixture review-gate state.' },
      { name: 'score_cv_comparisons', status: reviewGateStatus === 'proceed' ? 'completed' : 'skipped', note: 'Benchmark fixture scoring stage.' },
      { name: 'select_recommendation', status: reviewGateStatus === 'proceed' ? 'completed' : 'skipped', note: 'Benchmark fixture recommendation stage.' },
      { name: 'generate_verdict', status: reviewGateStatus === 'proceed' ? 'completed' : 'skipped', note: 'Benchmark fixture verdict stage.' },
      { name: 'generate_explanation', status: 'completed', note: 'Benchmark fixture explanation stage.' },
    ],
    consensus: {
      enabled: false,
      strategy: 'single_run',
      runs: 1,
      agreement: 'single_run',
      triggeredBy: [],
    },
    confidence: {
      extractionConfidence: reviewGateStatus === 'proceed' ? 0.92 : 0.54,
      informationQualityScore: reviewGateStatus === 'proceed' ? 88 : 46,
      reviewGateStatus,
    },
  };
}

function buildValidEvaluationResult(input: EvaluationInput): EvaluationResult {
  const now = '2026-01-01T00:00:00.000Z';
  const firstCv = input.cvProfiles[0];

  if (!firstCv) {
    throw new Error('At least one CV profile is required for benchmark fixtures');
  }

  return {
    id: `eval_${input.job.id}`,
    jobId: input.job.id,
    evaluatedCvResults: [
      {
        cvId: firstCv.cvId,
        totalScore: 88,
        hardSkipApplied: false,
        criterionScores: [
          {
            criterion: 'role_alignment',
            score: 35,
            maxScore: 40,
            note: 'Primary role aligns',
          },
        ],
        subcriterionScores: [
          {
            criterion: 'skills',
            subcriterion: 'core_stack',
            score: 22,
            maxScore: 25,
            note: 'Strong stack overlap',
          },
        ],
        appliedPenalties: [],
        note: 'Best match in sample benchmark set',
      },
    ],
    recommendedCvId: firstCv.cvId,
    verdict: 'apply',
    totalScore: 88,
    criterionScores: [
      {
        criterion: 'overall',
        score: 88,
        maxScore: 100,
        note: 'High overall compatibility',
      },
    ],
    subcriterionScores: [
      {
        criterion: 'skills',
        subcriterion: 'keywords',
        score: 20,
        maxScore: 25,
        note: 'Keywords strongly match',
      },
    ],
    appliedPenalties: [],
    hardSkipApplied: false,
    reviewGateStatus: input.reviewGateStatus,
    evaluationVersion: 'evaluation-v1',
    scoringVersion: 'scoring-v1',
    extractionVersion: input.job.extractionVersion,
    informationQualityScore: input.reviewGateStatus === 'proceed' ? 88 : 46,
    unknownDataFlags: [],
    explanationEvidencePayload: {
      matchedSignals: ['Strong role and skill alignment'],
      gapSignals: [],
      hardSkipReasons: [],
      recommendationReasons: ['Best score among active CVs'],
    },
    explanationSourceFields: {
      jobFields: ['title', 'description'],
      cvFields: ['primaryRole', 'coreStack'],
      preferenceFields: ['preferredKeywords'],
      usedInferredCompanyOrSectorSignal: false,
    },
    normalizedComparisonDescriptors: buildDefaultNormalizedComparisonDescriptors(),
    decisionTrace: buildDefaultDecisionTrace(input.reviewGateStatus),
    aiArtifactReferences: [],
    conciseExplanation: 'Strong match for backend requirements.',
    majorGapsSummary: [],
    detailedExplanation: 'The CV strongly matches role, stack, and preferred work setup.',
    suggestedCvChanges: [],
    nextAction: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

function buildBenchmarkEvaluationResult(benchmarkCase: BenchmarkCase): EvaluationResult {
  const now = '2026-01-01T00:00:00.000Z';
  const verdict = benchmarkCase.expectedVerdict;
  const recommendedCvId = benchmarkCase.expectedRecommendedCvId;
  const reviewGateStatus = benchmarkCase.input.reviewGateStatus;
  if (benchmarkCase.input.cvProfiles.length === 0) {
    throw new Error(`Benchmark case ${benchmarkCase.id} must include at least one CV profile.`);
  }

  const score =
    verdict === 'apply' ? 90 : verdict === 'consider' ? 66 : verdict === 'skip' ? 24 : 0;
  const totalScore = verdict === null ? null : score;
  const explanation =
    verdict === null
      ? 'Review gate is active, so no final verdict is emitted yet.'
      : verdict === 'apply'
        ? 'Strong fit across stack, role, and preferences.'
        : verdict === 'consider'
          ? 'Good overlap with a few remaining gaps.'
          : 'The fit is weak enough to skip for now.';

  return {
    id: `eval_${benchmarkCase.id}`,
    jobId: benchmarkCase.input.job.id,
    evaluatedCvResults: benchmarkCase.input.cvProfiles.map((cvProfile, index) => ({
      cvId: cvProfile.cvId,
      totalScore: Math.max(score - index * 9, 0),
      hardSkipApplied: false,
      criterionScores: [
        {
          criterion: 'role_alignment',
          score: Math.max(30 - index * 4, 0),
          maxScore: 40,
          note: index === 0 ? 'Primary CV candidate' : 'Secondary CV candidate',
        },
      ],
      subcriterionScores: [
        {
          criterion: 'skills',
          subcriterion: 'core_stack',
          score: Math.max(18 - index * 2, 0),
          maxScore: 25,
          note: index === 0 ? 'Most relevant stack overlap' : 'Useful fallback profile',
        },
      ],
      appliedPenalties: [],
      note: index === 0 ? 'Best benchmark candidate.' : 'Lower-scoring alternative candidate.',
    })),
    recommendedCvId,
    verdict,
    totalScore,
    criterionScores: [
      {
        criterion: 'overall',
        score,
        maxScore: 100,
        note: verdict === null ? 'Evaluation paused by review gate.' : 'Deterministic benchmark score.',
      },
    ],
    subcriterionScores: [
      {
        criterion: 'overall',
        subcriterion: 'stack_fit',
        score: verdict === null ? 0 : score - 5,
        maxScore: 25,
        note: verdict === null ? 'No final verdict is available yet.' : 'Primary stack fit drives the result.',
      },
    ],
    appliedPenalties: verdict === 'skip'
      ? [
          {
            code: 'weak_fit',
            label: 'Weak fit',
            severity: 1,
            impact: 12,
            reason: 'The job does not align closely enough with the available CVs.',
          },
        ]
      : [],
    hardSkipApplied: false,
    reviewGateStatus,
    evaluationVersion: 'evaluation-v1',
    scoringVersion: 'scoring-v1',
    extractionVersion: benchmarkCase.input.job.extractionVersion,
    informationQualityScore: reviewGateStatus === 'proceed' ? 90 : 42,
    unknownDataFlags: reviewGateStatus === 'proceed' ? [] : ['description_thin'],
    explanationEvidencePayload: {
      matchedSignals:
        verdict === null
          ? ['Extraction requires manual review before verdict generation.']
          : ['Role alignment', 'Preference alignment', 'Stack overlap'],
      gapSignals:
        verdict === 'apply'
          ? []
          : verdict === 'consider'
            ? ['One or two moderate gaps remain.']
            : verdict === 'skip'
              ? ['Major role or skill mismatch.']
              : ['Review gate prevents final scoring.'],
      hardSkipReasons: [],
      recommendationReasons:
        verdict === null
          ? ['Review gate blocks recommendation until the job is corrected.']
          : [`${benchmarkCase.summary}`],
    },
    explanationSourceFields: {
      jobFields: ['title', 'description'],
      cvFields: ['primaryRole', 'coreStack'],
      preferenceFields: ['preferredKeywords'],
      usedInferredCompanyOrSectorSignal: false,
    },
    normalizedComparisonDescriptors: buildDefaultNormalizedComparisonDescriptors(),
    decisionTrace: buildDefaultDecisionTrace(reviewGateStatus),
    aiArtifactReferences: [],
    conciseExplanation: explanation,
    majorGapsSummary:
      verdict === 'apply'
        ? []
        : verdict === 'consider'
          ? ['Some stack depth is missing.']
          : verdict === 'skip'
            ? ['The role leans outside the current fit zone.']
            : ['The job must be corrected before verdict generation.'],
    detailedExplanation: `${benchmarkCase.summary} The result is deterministic from the stored inputs.`,
    suggestedCvChanges:
      verdict === 'apply'
        ? []
        : verdict === 'consider'
          ? ['Emphasize the most relevant project and stack overlap.']
          : verdict === 'skip'
            ? ['No immediate CV change is likely to move this into a strong match.']
            : ['Confirm the extracted job fields before evaluating.'],
    nextAction: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('benchmark harness', () => {
  it('validates a contract-aligned evaluation result', () => {
    const sample = benchmarkCases[0];
    expect(sample).toBeDefined();

    const validation = validateEvaluationResultShape(buildValidEvaluationResult(sample!.input));
    expect(validation.valid).toBe(true);
    expect(validation.issues).toHaveLength(0);
  });

  it('rejects malformed evaluation output shape', () => {
    const malformedOutput = {
      id: 'eval_1',
      verdict: 'apply',
      totalScore: 75,
    };

    const validation = validateEvaluationResultShape(malformedOutput);
    expect(validation.valid).toBe(false);
    expect(validation.issues.length).toBeGreaterThan(0);
    expect(validation.issues.some((issue) => issue.path.endsWith('.jobId'))).toBe(true);
    expect(validation.issues.some((issue) => issue.path.endsWith('.evaluationVersion'))).toBe(true);
  });

  it('runs benchmark cases deterministically with an injected evaluator', async () => {
    const result = await runBenchmarkCases(benchmarkCases, (_input, benchmarkCaseId) => {
      const benchmarkCase = benchmarkCases.find((entry) => entry.id === benchmarkCaseId);
      if (!benchmarkCase) {
        throw new Error(`Missing benchmark case ${benchmarkCaseId}`);
      }
      return buildBenchmarkEvaluationResult(benchmarkCase);
    });

    expect(result.passed).toBe(true);
    expect(result.totalCases).toBe(benchmarkCases.length);
    expect(result.failedCases).toBe(0);
    expect(result.caseResults.every((entry) => entry.outputShapeValid)).toBe(true);
    expect(result.caseResults.some((entry) => entry.actualReviewGateStatus === 'review_required')).toBe(true);
    expect(new Set(benchmarkCases.map((entry) => entry.expectedVerdict))).toEqual(new Set(['apply', 'consider', 'skip', null]));
    expect(benchmarkCases.some((entry) => entry.input.reviewGateStatus === 'review_required')).toBe(true);
  });

  it('validates analytics event payload shape and schema expectations', () => {
    const expectations = validateAnalyticsEventSchemaExpectations();
    expect(expectations.valid).toBe(true);
    expect(expectations.duplicateEventNames).toHaveLength(0);
    expect(expectations.missingCriticalEvents).toHaveLength(0);

    const validEvent: AnalyticsEvent = {
      name: 'evaluation_completed',
      timestamp: '2026-01-01T00:00:00.000Z',
      properties: {
        userId: 'usr_demo',
        jobId: 'job_backend_1',
        cvId: 'cv_backend_1',
        sourceType: 'greenhouse',
        reviewRequiredFlag: false,
        evaluationVersion: 'evaluation-v1',
        verdict: 'apply',
      },
    };

    const validEventValidation = validateAnalyticsEvent(validEvent);
    expect(validEventValidation.valid).toBe(true);

    const invalidEvent = {
      name: 'invalid_event_name',
      timestamp: 'not-a-date',
      properties: {
        reviewRequiredFlag: 'false',
      },
    };

    const invalidEventValidation = validateAnalyticsEvent(invalidEvent);
    expect(invalidEventValidation.valid).toBe(false);
    expect(invalidEventValidation.issues.length).toBeGreaterThan(0);
  });
});
