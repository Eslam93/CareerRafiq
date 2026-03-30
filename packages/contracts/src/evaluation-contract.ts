import type {
  AppliedPenalty,
  CVProfile,
  CriterionScore,
  EvaluationEvidencePayload,
  EvaluationResult,
  Job,
  PreferenceProfile,
  ReviewGateStatus,
  SubcriterionScore,
} from './domain-model.js';

export interface EvaluationInput {
  job: Job;
  cvProfiles: CVProfile[];
  preferenceProfile: PreferenceProfile;
  reviewGateStatus: ReviewGateStatus;
  preferredCvId?: string | null;
}

export interface ScoredCvComparison {
  cvId: string;
  totalScore: number;
  criterionScores: CriterionScore[];
  subcriterionScores: SubcriterionScore[];
  appliedPenalties: AppliedPenalty[];
  hardSkipApplied: boolean;
  note: string;
}

export interface EvaluationOutput {
  result: EvaluationResult;
  explanationEvidencePayload: EvaluationEvidencePayload;
}

export interface ScoringModelDescriptor {
  evaluationVersion: string;
  scoringVersion: string;
  thresholds: {
    apply: number;
    consider: number;
  };
}
