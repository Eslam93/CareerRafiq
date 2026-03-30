import type { ExtractionCandidate, ExtractionPayload, ExtractionValidationResult, NormalizedJob, ReviewGateStatus } from '@career-rafiq/contracts';
import { countKeywordMatches, normalizeText, unique } from './helpers.js';

function inferScopeSignals(text: string): string[] {
  const normalized = normalizeText(text);
  const signals: string[] = [];
  if (normalized.includes('ownership')) signals.push('ownership');
  if (normalized.includes('greenfield') || normalized.includes('0 to 1') || normalized.includes('zero to one')) signals.push('greenfield');
  if (normalized.includes('team lead') || normalized.includes('leadership') || normalized.includes('mentor')) signals.push('leadership');
  if (normalized.includes('stakeholder') || normalized.includes('cross functional')) signals.push('cross_functional_scope');
  if (normalized.includes('architecture') || normalized.includes('platform')) signals.push('platform_scope');
  return unique(signals);
}

function inferBooleanSignal(text: string, keywords: string[]): boolean | null {
  const normalized = normalizeText(text);
  if (keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
    return true;
  }
  return null;
}

function normalizeCandidate(candidate: ExtractionCandidate): NormalizedJob {
  const title = candidate.title?.trim() || null;
  const description = candidate.description?.trim() || '';
  const combinedText = `${title ?? ''} ${description}`;
  return {
    title,
    company: candidate.company?.trim() || null,
    location: candidate.location?.trim() || null,
    workSetup: candidate.workSetup ?? 'unknown',
    employmentType: candidate.employmentType ?? 'unknown',
    description,
    recruiterOrPosterSignal: candidate.recruiterOrPosterSignal?.trim() || null,
    companySector: candidate.companySector?.trim() || null,
    companyType: candidate.companyType?.trim() || null,
    keywords: unique([
      ...candidate.keywords,
      ...countKeywordMatches(`${title ?? ''} ${description}`, ['typescript', 'javascript', 'python', 'react', 'node', 'aws', 'kubernetes', 'terraform', 'fastapi', 'postgres', 'llm', 'ml']),
    ]),
    scopeSignals: inferScopeSignals(combinedText),
    greenfieldSignal: inferBooleanSignal(combinedText, ['greenfield', '0 to 1', 'zero to one', 'new product']),
    highOwnershipSignal: inferBooleanSignal(combinedText, ['ownership', 'high ownership', 'own roadmap', 'end to end ownership']),
  };
}

export function validateExtraction(payload: ExtractionPayload): ExtractionValidationResult {
  const candidate = payload.extractionCandidate;
  const missingFields: ExtractionValidationResult['missingFields'] = [];
  if (!candidate.title?.trim()) missingFields.push('title');
  if (!candidate.company?.trim()) missingFields.push('company');
  if (!candidate.description?.trim()) missingFields.push('description');

  const uncertainFields: ExtractionValidationResult['uncertainFields'] = [];
  if (!candidate.location?.trim()) uncertainFields.push('location');
  if (candidate.workSetup === 'unknown') uncertainFields.push('workSetup');
  if (candidate.employmentType === 'unknown') uncertainFields.push('employmentType');
  if (payload.ambiguityFlags.length > 0) uncertainFields.push('recruiterOrPosterSignal');

  const reasons: string[] = [];
  if (payload.ambiguityFlags.length > 0) reasons.push(`Ambiguity flags present: ${payload.ambiguityFlags.join(', ')}.`);
  if (missingFields.length > 0) reasons.push(`Missing critical fields: ${missingFields.join(', ')}.`);
  if (uncertainFields.length > 0) reasons.push(`Uncertain fields: ${uncertainFields.join(', ')}.`);

  const normalizedJobObject = normalizeCandidate(candidate);
  const confidence = Math.max(0, 1 - missingFields.length * 0.25 - uncertainFields.length * 0.08 - payload.ambiguityFlags.length * 0.08);
  const coherenceConfidence = Math.max(0, 1 - payload.ambiguityFlags.length * 0.35 - (normalizedJobObject.description.length < 120 ? 0.2 : 0));
  const status: ReviewGateStatus =
    missingFields.length >= 2 || (!candidate.title && !candidate.company && !candidate.description)
      ? 'failed'
      : missingFields.length > 0 || confidence < 0.55 || payload.ambiguityFlags.length > 0
        ? 'review_required'
        : 'proceed';

  const mergedFieldProvenance: NonNullable<ExtractionValidationResult['mergedFieldProvenance']> = {
    title: 'deterministic',
    company: 'deterministic',
    location: 'deterministic',
    workSetup: 'deterministic',
    employmentType: 'deterministic',
    description: 'deterministic',
    recruiterOrPosterSignal: 'deterministic',
    companySector: 'deterministic',
    companyType: 'deterministic',
    keywords: 'deterministic',
    scopeSignals: 'deterministic',
    greenfieldSignal: 'deterministic',
    highOwnershipSignal: 'deterministic',
  };

  const fieldEvidence: NonNullable<ExtractionValidationResult['fieldEvidence']> = [
    {
      field: 'title',
      confidence: candidate.title?.trim() ? 0.95 : 0,
      provenance: 'deterministic',
      evidence: candidate.title?.trim() ? [candidate.title.trim()] : [],
      reasons: candidate.title?.trim() ? ['Title was extracted directly from the captured content.'] : ['Title was missing from the extracted candidate.'],
    },
    {
      field: 'company',
      confidence: candidate.company?.trim() ? 0.95 : 0,
      provenance: 'deterministic',
      evidence: candidate.company?.trim() ? [candidate.company.trim()] : [],
      reasons: candidate.company?.trim() ? ['Company was extracted directly from the captured content.'] : ['Company was missing from the extracted candidate.'],
    },
    {
      field: 'description',
      confidence: normalizedJobObject.description.length >= 120 ? 0.9 : normalizedJobObject.description.length > 0 ? 0.55 : 0,
      provenance: 'deterministic',
      evidence: normalizedJobObject.description ? [normalizedJobObject.description.slice(0, 280)] : [],
      reasons: normalizedJobObject.description
        ? ['Description content was preserved for evaluation and validation.']
        : ['Description was missing from the extracted candidate.'],
    },
    {
      field: 'location',
      confidence: candidate.location?.trim() ? 0.8 : 0.2,
      provenance: 'deterministic',
      evidence: candidate.location?.trim() ? [candidate.location.trim()] : [],
      reasons: candidate.location?.trim() ? ['Location was available in the extracted candidate.'] : ['Location was not explicitly available in the extracted candidate.'],
    },
    {
      field: 'workSetup',
      confidence: candidate.workSetup && candidate.workSetup !== 'unknown' ? 0.75 : 0.2,
      provenance: 'deterministic',
      evidence: candidate.workSetup && candidate.workSetup !== 'unknown' ? [candidate.workSetup] : [],
      reasons: candidate.workSetup && candidate.workSetup !== 'unknown'
        ? ['Work setup was extracted directly from the captured content.']
        : ['Work setup remained unknown after deterministic extraction.'],
    },
    {
      field: 'employmentType',
      confidence: candidate.employmentType && candidate.employmentType !== 'unknown' ? 0.75 : 0.2,
      provenance: 'deterministic',
      evidence: candidate.employmentType && candidate.employmentType !== 'unknown' ? [candidate.employmentType] : [],
      reasons: candidate.employmentType && candidate.employmentType !== 'unknown'
        ? ['Employment type was extracted directly from the captured content.']
        : ['Employment type remained unknown after deterministic extraction.'],
    },
    {
      field: 'recruiterOrPosterSignal',
      confidence: candidate.recruiterOrPosterSignal?.trim() ? 0.65 : 0.2,
      provenance: 'deterministic',
      evidence: candidate.recruiterOrPosterSignal?.trim() ? [candidate.recruiterOrPosterSignal.trim()] : [],
      reasons: candidate.recruiterOrPosterSignal?.trim()
        ? ['Recruiter or poster signal was detected in the captured content.']
        : ['No recruiter or poster signal was extracted.'],
    },
    {
      field: 'companySector',
      confidence: candidate.companySector?.trim() ? 0.65 : 0.2,
      provenance: 'deterministic',
      evidence: candidate.companySector?.trim() ? [candidate.companySector.trim()] : [],
      reasons: candidate.companySector?.trim()
        ? ['Company sector was available in the extracted candidate.']
        : ['Company sector was not available from deterministic extraction alone.'],
    },
    {
      field: 'companyType',
      confidence: candidate.companyType?.trim() ? 0.65 : 0.2,
      provenance: 'deterministic',
      evidence: candidate.companyType?.trim() ? [candidate.companyType.trim()] : [],
      reasons: candidate.companyType?.trim()
        ? ['Company type was available in the extracted candidate.']
        : ['Company type was not available from deterministic extraction alone.'],
    },
    {
      field: 'keywords',
      confidence: normalizedJobObject.keywords.length >= 4 ? 0.85 : normalizedJobObject.keywords.length > 0 ? 0.55 : 0.2,
      provenance: 'deterministic',
      evidence: normalizedJobObject.keywords,
      reasons: normalizedJobObject.keywords.length > 0
        ? ['Keyword signals were preserved and normalized from title and description content.']
        : ['No durable keyword signals were retained from deterministic extraction.'],
    },
    {
      field: 'scopeSignals',
      confidence: normalizedJobObject.scopeSignals.length > 0 ? 0.7 : 0.25,
      provenance: 'deterministic',
      evidence: normalizedJobObject.scopeSignals,
      reasons: normalizedJobObject.scopeSignals.length > 0
        ? ['Scope signals were inferred deterministically from the normalized job text.']
        : ['No scope signals were inferred from deterministic extraction.'],
    },
    {
      field: 'greenfieldSignal',
      confidence: normalizedJobObject.greenfieldSignal === true ? 0.7 : 0.3,
      provenance: 'deterministic',
      evidence: normalizedJobObject.greenfieldSignal === true ? ['true'] : [],
      reasons: normalizedJobObject.greenfieldSignal === true
        ? ['Greenfield language was detected in the normalized job text.']
        : ['Greenfield signal was not clearly supported by deterministic extraction.'],
    },
    {
      field: 'highOwnershipSignal',
      confidence: normalizedJobObject.highOwnershipSignal === true ? 0.7 : 0.3,
      provenance: 'deterministic',
      evidence: normalizedJobObject.highOwnershipSignal === true ? ['true'] : [],
      reasons: normalizedJobObject.highOwnershipSignal === true
        ? ['High-ownership language was detected in the normalized job text.']
        : ['High-ownership signal was not clearly supported by deterministic extraction.'],
    },
  ];

  return {
    status,
    reasons,
    missingFields,
    uncertainFields,
    normalizedJobObject,
    correctionAllowedFields: unique([...missingFields, ...uncertainFields] as string[]) as ExtractionValidationResult['correctionAllowedFields'],
    extractionConfidence: confidence,
    fieldEvidence,
    mergedFieldProvenance,
    coherenceAssessment: {
      isSingleJob: payload.ambiguityFlags.length === 0,
      confidence: coherenceConfidence,
      note:
        payload.ambiguityFlags.length === 0
          ? 'Deterministic extraction indicates one coherent job payload.'
          : `Potential mixed or noisy job content detected: ${payload.ambiguityFlags.join(', ')}.`,
    },
  };
}

export function captureSourceToValidationStatus(sourceIdentifier: string): ReviewGateStatus {
  return sourceIdentifier === 'unsupported' ? 'failed' : 'proceed';
}
