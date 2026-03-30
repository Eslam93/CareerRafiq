import type { ExtractionPayload, ExtractionValidationResult } from '@career-rafiq/contracts';
import type { CV, CVVersion, User } from '@career-rafiq/contracts';

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  accessLevel: 'temporary' | 'verified';
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMagicLinkToken {
  id: string;
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface EmailOutboxRecord {
  id: string;
  userId: string | null;
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
}

export interface StoredCvFile extends CV {
  mimeType: string | null;
  storedFilePath: string | null;
}

export interface StoredCvVersion extends CVVersion {
  mimeType: string | null;
  storedFilePath: string | null;
}

export interface JobExtractionRecord {
  id: string;
  userId: string;
  jobId: string;
  extractionVersion: string;
  reviewCount: number;
  history: Array<{
    timestamp: string;
    action: 'captured' | 'reextracted' | 'review_edited' | 'review_confirmed';
    status: import('@career-rafiq/contracts').ReviewGateStatus;
    extractionConfidence: number;
    note: string;
    source: 'deterministic' | 'ai' | 'merged' | 'manual';
  }>;
  extraction: ExtractionPayload;
  validation: ExtractionValidationResult;
  aiArtifactReferences: import('@career-rafiq/contracts').AiArtifactReference[];
  consensusSummary: import('@career-rafiq/contracts').AiConsensusSummary | null;
  createdAt: string;
  updatedAt: string;
}

export type StoredAiArtifact = import('@career-rafiq/contracts').AiArtifact;
export type EyeSessionRecord = import('@career-rafiq/contracts').EyeSession;
export type DiagnosticEventRecord = import('@career-rafiq/contracts').DiagnosticEvent;

export interface AnalyticsEventRecord {
  id: string;
  userId: string | null;
  name: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

export interface SetupStateRecord {
  user: User;
  cvs: StoredCvFile[];
  cvProfiles: import('@career-rafiq/contracts').CVProfile[];
  preferenceProfile: import('@career-rafiq/contracts').PreferenceProfile | null;
}

export interface TrackerDetailRecord {
  trackerItem: import('@career-rafiq/contracts').TrackerItem | null;
  job: import('@career-rafiq/contracts').Job | null;
  evaluation: import('@career-rafiq/contracts').EvaluationResult | null;
  validation: ExtractionValidationResult | null;
  extractionMeta: import('@career-rafiq/contracts').JobExtractionMeta | null;
  historicalEvaluations: import('@career-rafiq/contracts').EvaluationResult[];
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
