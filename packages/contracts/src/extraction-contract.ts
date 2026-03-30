import type { FieldProvenance, Job, NormalizedJob, ReviewGateStatus, SourceIdentifier } from './domain-model.js';

export interface ExtractionCandidate {
  title: string | null;
  company: string | null;
  location: string | null;
  workSetup: NormalizedJob['workSetup'];
  employmentType: NormalizedJob['employmentType'];
  description: string | null;
  recruiterOrPosterSignal: string | null;
  companySector: string | null;
  companyType: string | null;
  keywords: string[];
}

export interface ExtractionPayload {
  sourceIdentifier: SourceIdentifier;
  sourceUrl: string;
  rawCaptureContent: string;
  extractionCandidate: ExtractionCandidate;
  sourceConfidenceHints: string[];
  ambiguityFlags: string[];
  extractionNotes: string[];
  sourceOfTruthSummary?: string | null;
}

export interface ExtractionValidationResult {
  status: ReviewGateStatus;
  reasons: string[];
  missingFields: Array<keyof ExtractionCandidate | keyof NormalizedJob>;
  uncertainFields: Array<keyof ExtractionCandidate | keyof NormalizedJob>;
  normalizedJobObject: Job['normalizedJobObject'] | null;
  correctionAllowedFields: Array<keyof ExtractionCandidate | keyof NormalizedJob>;
  extractionConfidence: number;
  fieldEvidence?: Array<{
    field: keyof ExtractionCandidate | keyof NormalizedJob | string;
    confidence: number;
    provenance: FieldProvenance;
    evidence: string[];
    reasons: string[];
  }>;
  mergedFieldProvenance?: Record<string, FieldProvenance>;
  coherenceAssessment?: {
    isSingleJob: boolean;
    confidence: number;
    note: string;
  } | null;
}
