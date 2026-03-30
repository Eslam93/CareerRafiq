import type {
  AppliedPenalty,
  CVProfile,
  CriterionScore,
  EvaluationEvidencePayload,
  EvaluationInput,
  EvaluationResult,
  EvaluatedCvResult,
  PreferenceLevel,
  PreferenceProfile,
  ScoredCvComparison,
  Seniority,
  SubcriterionScore,
  Verdict,
} from '@career-rafiq/contracts';
import {
  SENIORITY_ORDER,
  createId,
  includesText,
  inferSeniority,
  joinNonEmpty,
  matchRoleTemplate,
  normalizeText,
  nowIso,
  unique,
} from './helpers.js';
import { buildEvaluationNextAction } from './next-actions.js';
import { normalizePreferenceProfile } from './preferences.js';
import { validateExtraction } from './extraction.js';

const MAIN_WEIGHTS = {
  cv_to_role_match: 50,
  user_preference_fit: 30,
  evidence_strength: 20,
} as const;

const SUB_WEIGHTS = {
  role_alignment: 15,
  skills_and_stack_match: 18,
  seniority_fit: 8,
  career_track_fit: 6,
  excluded_domain_conflict: 3,
  work_setup_fit: 6,
  location_fit: 8,
  employment_type_fit: 4,
  preferred_and_avoided_titles_or_role_tracks: 6,
  preferred_required_and_avoided_keywords: 6,
  extraction_completeness: 7,
  extraction_coherence: 6,
  presence_of_critical_fields: 7,
} as const;

const SUB_TO_CRITERION: Record<keyof typeof SUB_WEIGHTS, keyof typeof MAIN_WEIGHTS> = {
  role_alignment: 'cv_to_role_match',
  skills_and_stack_match: 'cv_to_role_match',
  seniority_fit: 'cv_to_role_match',
  career_track_fit: 'cv_to_role_match',
  excluded_domain_conflict: 'cv_to_role_match',
  work_setup_fit: 'user_preference_fit',
  location_fit: 'user_preference_fit',
  employment_type_fit: 'user_preference_fit',
  preferred_and_avoided_titles_or_role_tracks: 'user_preference_fit',
  preferred_required_and_avoided_keywords: 'user_preference_fit',
  extraction_completeness: 'evidence_strength',
  extraction_coherence: 'evidence_strength',
  presence_of_critical_fields: 'evidence_strength',
};

type NormalizedPreferenceLists = ReturnType<typeof normalizePreferenceProfile>['evaluationReady']['normalizedTextLists'];
type SubcriterionKey = keyof typeof SUB_WEIGHTS;

type InferredCompanySignals = {
  companySector: string | null;
  companyType: string | null;
  used: boolean;
};

type ScoredSubcriterion = {
  key: SubcriterionKey;
  value: number;
  note: string;
};

type ComparisonEvidence = {
  matchedSignals: string[];
  gapSignals: string[];
  recommendationReasons: string[];
  hardSkipReasons: string[];
  suggestedCvChanges: string[];
  penalties: AppliedPenalty[];
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function weightedScore(key: SubcriterionKey, value: number): number {
  return roundScore(clampUnit(value) * SUB_WEIGHTS[key]);
}

function preferenceLevelToUnit(level: PreferenceLevel): number {
  switch (level) {
    case 'top':
      return 1;
    case 'ok':
      return 0.75;
    case 'neutral':
      return 0.5;
    case 'not_recommended':
      return 0.25;
    case 'hard_skip':
      return 0;
    default:
      return 0.5;
  }
}

function buildComparableTexts(...values: Array<string | null | undefined>): string[] {
  return unique(values.map((value) => normalizeText(value)).filter(Boolean));
}

function findNormalizedMatches(candidates: string[], comparables: string[]): string[] {
  return unique(candidates.filter((candidate) => comparables.some((comparable) => comparable.includes(candidate))));
}

function seniorityRank(value: Seniority): number {
  return SENIORITY_ORDER.indexOf(value);
}

function isKnownSeniority(value: Seniority): boolean {
  return value !== 'unknown';
}

function inferCompanySignals(jobText: string, explicitCompanySector: string | null, explicitCompanyType: string | null): InferredCompanySignals {
  const normalized = normalizeText(jobText);
  const companySector = explicitCompanySector ?? (() => {
    if (['fintech', 'payments', 'banking', 'financial'].some((token) => normalized.includes(token))) return 'fintech';
    if (['healthcare', 'medical', 'clinical', 'patient'].some((token) => normalized.includes(token))) return 'healthcare';
    if (['data platform', 'analytics', 'warehouse', 'bi', 'data engineering'].some((token) => normalized.includes(token))) return 'data';
    if (['saas', 'software', 'developer platform', 'platform engineering', 'cloud'].some((token) => normalized.includes(token))) return 'software';
    return null;
  })();
  const companyType = explicitCompanyType ?? (() => {
    if (['series a', 'series b', 'startup', 'early stage', 'greenfield'].some((token) => normalized.includes(token))) return 'startup';
    if (['scale-up', 'scale up', 'high growth'].some((token) => normalized.includes(token))) return 'scale-up';
    if (['enterprise', 'fortune 500', 'global company', 'large organization'].some((token) => normalized.includes(token))) return 'enterprise';
    return null;
  })();

  return {
    companySector,
    companyType,
    used: Boolean((!explicitCompanySector && companySector) || (!explicitCompanyType && companyType)),
  };
}

function buildNormalizedComparisonDescriptors(
  job: EvaluationInput['job'],
  preferenceProfile: PreferenceProfile,
  normalizedPreferences: NormalizedPreferenceLists,
  inferredCompanySignals: InferredCompanySignals,
): EvaluationResult['normalizedComparisonDescriptors'] {
  const jobText = joinNonEmpty([
    job.normalizedJobObject.title,
    job.normalizedJobObject.company,
    job.normalizedJobObject.description,
    job.normalizedJobObject.companySector,
    job.normalizedJobObject.companyType,
    job.normalizedJobObject.keywords.join(' '),
  ]);
  const jobTemplate = matchRoleTemplate(jobText);

  return {
    version: 'eval-normalization-v2',
    job: {
      titleTokens: buildComparableTexts(job.normalizedJobObject.title, job.normalizedJobObject.description),
      roleTrack: jobTemplate?.careerTrack ?? null,
      seniority: inferSeniority(jobText),
      locationTokens: buildComparableTexts(job.normalizedJobObject.location),
      workSetup: job.normalizedJobObject.workSetup,
      employmentType: job.normalizedJobObject.employmentType,
      keywordTokens: buildComparableTexts(job.normalizedJobObject.keywords.join(' '), job.normalizedJobObject.description),
      companySector: job.normalizedJobObject.companySector,
      companyType: job.normalizedJobObject.companyType,
      inferredCompanySector: inferredCompanySignals.companySector,
      inferredCompanyType: inferredCompanySignals.companyType,
      scopeSignals: job.normalizedJobObject.scopeSignals,
      greenfieldSignal: job.normalizedJobObject.greenfieldSignal,
      highOwnershipSignal: job.normalizedJobObject.highOwnershipSignal,
    },
    preferences: {
      preferredRoleTracks: normalizedPreferences.preferredRoleTracks,
      avoidedRoleTracks: normalizedPreferences.avoidedRoleTracks,
      preferredJobTitles: normalizedPreferences.preferredJobTitles,
      avoidedJobTitles: normalizedPreferences.avoidedJobTitles,
      preferredLocations: normalizedPreferences.preferredLocations,
      avoidedLocations: normalizedPreferences.avoidedLocations,
      preferredSectors: normalizedPreferences.preferredSectors,
      avoidedSectors: normalizedPreferences.avoidedSectors,
      preferredCompanyTypes: normalizedPreferences.preferredCompanyTypes,
      avoidedCompanyTypes: normalizedPreferences.avoidedCompanyTypes,
      preferredKeywords: normalizedPreferences.preferredKeywords,
      requiredKeywords: normalizedPreferences.requiredKeywords,
      avoidedKeywords: normalizedPreferences.avoidedKeywords,
      preferredSeniorityRange: { ...preferenceProfile.preferredSeniorityRange },
      scopePreferences: normalizedPreferences.scopePreferences,
      preferGreenfield: preferenceProfile.preferGreenfield,
      preferHighOwnership: preferenceProfile.preferHighOwnership,
    },
  };
}

function buildDecisionTrace(
  extractionConfidence: number,
  informationQualityScore: number,
  reviewGateStatus: 'proceed' | 'review_required' | 'failed',
): EvaluationResult['decisionTrace'] {
  const blocked = reviewGateStatus !== 'proceed';
  return {
    pipelineSteps: [
      { name: 'normalize_inputs', status: 'completed', note: 'Normalized comparison descriptors were created from job, CV, and preference inputs.' },
      { name: 'validate_inputs', status: 'completed', note: blocked ? 'Validation completed and the review gate remained active.' : 'Validation completed without blocking the evaluation.' },
      { name: 'review_gate', status: blocked ? 'completed' : 'skipped', note: blocked ? 'Review is required before a final verdict can be trusted.' : 'No review gate was required for this evaluation run.' },
      { name: 'score_cv_comparisons', status: blocked ? 'skipped' : 'completed', note: blocked ? 'Per-CV scoring was skipped because review is required.' : 'All active CVs were scored against the PRD-weighted model.' },
      { name: 'select_recommendation', status: blocked ? 'skipped' : 'completed', note: blocked ? 'Recommendation selection depends on successful scoring.' : 'The strongest CV was selected using PRD tie-break rules.' },
      { name: 'generate_verdict', status: blocked ? 'skipped' : 'completed', note: blocked ? 'Verdict generation is blocked until review is resolved.' : 'Versioned verdict thresholds were applied to the selected CV result.' },
      { name: 'generate_explanation', status: 'completed', note: blocked ? 'A review-required explanation was produced.' : 'Explanation and major gaps were derived from the stored scores and penalties.' },
    ],
    consensus: {
      enabled: false,
      strategy: 'single_run',
      runs: 1,
      agreement: 'single_run',
      triggeredBy: [],
    },
    confidence: {
      extractionConfidence,
      informationQualityScore,
      reviewGateStatus,
    },
  };
}

function subcriterionToScore(subcriterion: ScoredSubcriterion): SubcriterionScore {
  return {
    criterion: SUB_TO_CRITERION[subcriterion.key],
    subcriterion: subcriterion.key,
    score: weightedScore(subcriterion.key, subcriterion.value),
    maxScore: SUB_WEIGHTS[subcriterion.key],
    note: subcriterion.note,
  };
}

function aggregateCriterionScores(subcriterionScores: SubcriterionScore[]): CriterionScore[] {
  return Object.entries(MAIN_WEIGHTS).map(([criterion, maxScore]) => ({
    criterion,
    score: roundScore(
      subcriterionScores
        .filter((entry) => entry.criterion === criterion)
        .reduce((total, entry) => total + entry.score, 0),
    ),
    maxScore,
    note: `Weighted ${criterion.replaceAll('_', ' ')} score derived from PRD subcriteria.`,
  }));
}

function computeUnknownDataFlags(job: EvaluationInput['job']): string[] {
  const flags: string[] = [];
  if (!job.normalizedJobObject.title) flags.push('title_missing');
  if (!job.normalizedJobObject.company) flags.push('company_missing');
  if (!job.normalizedJobObject.location) flags.push('location_missing');
  if (job.normalizedJobObject.workSetup === 'unknown') flags.push('work_setup_unknown');
  if (job.normalizedJobObject.employmentType === 'unknown') flags.push('employment_type_unknown');
  if (!job.normalizedJobObject.description.trim()) flags.push('description_missing');
  if (job.normalizedJobObject.description.trim().length < 120) flags.push('description_thin');
  if (!job.normalizedJobObject.companySector) flags.push('company_sector_missing');
  if (!job.normalizedJobObject.companyType) flags.push('company_type_missing');
  if (job.normalizedJobObject.keywords.length === 0) flags.push('keywords_missing');
  return flags;
}

function scoreEvidenceStrength(
  job: EvaluationInput['job'],
  validation: ReturnType<typeof validateExtraction>,
): ScoredSubcriterion[] {
  const descriptionLength = job.normalizedJobObject.description.trim().length;
  const completeness = !job.normalizedJobObject.title || descriptionLength === 0
    ? 0
    : descriptionLength >= 600
      ? 1
      : descriptionLength >= 250
        ? 0.75
        : descriptionLength >= 120
          ? 0.5
          : 0.25;

  const coherence = validation.status === 'failed'
    ? 0
    : validation.status === 'review_required'
      ? 0.25
      : 1;

  const criticalFieldsPresent = [
    Boolean(job.normalizedJobObject.title),
    Boolean(job.normalizedJobObject.company),
    Boolean(job.normalizedJobObject.description.trim()),
    Boolean(job.normalizedJobObject.location || job.normalizedJobObject.workSetup !== 'unknown'),
  ].filter(Boolean).length;
  const presenceOfCriticalFields =
    criticalFieldsPresent === 4 ? 1 :
    criticalFieldsPresent === 3 ? 0.75 :
    criticalFieldsPresent === 2 ? 0.5 :
    criticalFieldsPresent === 1 ? 0.25 : 0;

  return [
    {
      key: 'extraction_completeness',
      value: completeness,
      note: 'Scored from job title plus description sufficiency for evaluation.',
    },
    {
      key: 'extraction_coherence',
      value: coherence,
      note: validation.status === 'proceed' ? 'Extraction represents one coherent job.' : 'Extraction has mixed, noisy, or review-required signals.',
    },
    {
      key: 'presence_of_critical_fields',
      value: presenceOfCriticalFields,
      note: `${criticalFieldsPresent}/4 critical fields were available.`,
    },
  ];
}

function scoreCvComparison(
  cvProfile: CVProfile,
  input: EvaluationInput,
  normalizedDescriptors: EvaluationResult['normalizedComparisonDescriptors'],
  evidenceScores: ScoredSubcriterion[],
): ScoredCvComparison & ComparisonEvidence {
  const jobText = joinNonEmpty([
    input.job.normalizedJobObject.title,
    input.job.normalizedJobObject.company,
    input.job.normalizedJobObject.description,
    input.job.normalizedJobObject.companySector,
    input.job.normalizedJobObject.companyType,
    input.job.normalizedJobObject.keywords.join(' '),
  ]);
  const cvText = joinNonEmpty([
    cvProfile.primaryRole,
    cvProfile.secondaryRoles.join(' '),
    cvProfile.careerTrack,
    cvProfile.coreStack.join(' '),
    cvProfile.positioningSummary,
  ]);

  const matchedSignals: string[] = [];
  const gapSignals: string[] = [];
  const recommendationReasons: string[] = [];
  const hardSkipReasons: string[] = [];
  const suggestedCvChanges: string[] = [];
  const penalties: AppliedPenalty[] = [];

  const jobRoleTemplate = matchRoleTemplate(jobText);
  const cvRoleTemplate = matchRoleTemplate(cvText);
  const normalizedJobRole = normalizeText(input.job.normalizedJobObject.title ?? jobRoleTemplate?.primaryRole ?? '');
  const normalizedPrimaryRole = normalizeText(cvProfile.primaryRole);
  const normalizedSecondaryRoles = cvProfile.secondaryRoles.map((role) => normalizeText(role));
  const roleAlignment =
    normalizedJobRole && normalizedPrimaryRole && normalizedJobRole.includes(normalizedPrimaryRole)
      ? 1
      : normalizedSecondaryRoles.some((role) => normalizedJobRole.includes(role))
        ? 0.75
        : jobRoleTemplate?.careerTrack && cvProfile.careerTrack && jobRoleTemplate.careerTrack === cvProfile.careerTrack
          ? 0.5
          : cvRoleTemplate?.careerTrack && jobRoleTemplate?.careerTrack && cvRoleTemplate.careerTrack === jobRoleTemplate.careerTrack
            ? 0.5
            : cvProfile.primaryRole
              ? 0.25
              : 0;
  if (roleAlignment >= 0.75) matchedSignals.push('Role alignment is strong for this CV.');
  else if (roleAlignment <= 0.25) gapSignals.push('Role alignment is weak for this CV.');

  const requiredJobSkills = unique(
    [
      ...input.job.normalizedJobObject.keywords,
      ...normalizedDescriptors.job.keywordTokens,
    ].map((value) => value.trim()).filter(Boolean),
  );
  const matchedSkills = cvProfile.coreStack.filter((skill) =>
    requiredJobSkills.some((jobSkill) => normalizeText(jobSkill).includes(normalizeText(skill)) || normalizeText(skill).includes(normalizeText(jobSkill))),
  );
  const skillsCoverage = requiredJobSkills.length === 0 ? 0.5 : matchedSkills.length / Math.max(1, requiredJobSkills.length);
  const skillsAndStackMatch =
    skillsCoverage >= 0.75 ? 1 :
    skillsCoverage >= 0.5 ? 0.75 :
    skillsCoverage >= 0.25 ? 0.5 :
    skillsCoverage > 0 ? 0.25 : 0;
  if (matchedSkills.length > 0) matchedSignals.push(`Skill overlap includes ${matchedSkills.slice(0, 4).join(', ')}.`);
  else gapSignals.push('Core stack overlap is limited.');

  const jobSeniority = normalizedDescriptors.job.seniority;
  const cvRank = seniorityRank(cvProfile.seniority);
  const jobRank = seniorityRank(jobSeniority);
  const seniorityDistance =
    !isKnownSeniority(cvProfile.seniority) || !isKnownSeniority(jobSeniority) || cvRank === -1 || jobRank === -1
      ? -1
      : Math.abs(cvRank - jobRank);
  const seniorityFit =
    seniorityDistance === -1 ? 0.5 :
    seniorityDistance === 0 ? 1 :
    seniorityDistance === 1 ? 0.75 :
    seniorityDistance === 2 ? 0.5 :
    seniorityDistance === 3 ? 0.25 : 0;
  if (seniorityFit >= 0.75) matchedSignals.push('Seniority fit is strong.');
  else if (seniorityFit <= 0.25) gapSignals.push(`Seniority mismatch detected (${cvProfile.seniority} vs ${jobSeniority}).`);

  const careerTrackFit =
    normalizedDescriptors.job.roleTrack && cvProfile.careerTrack && normalizedDescriptors.job.roleTrack === cvProfile.careerTrack
      ? 1
      : normalizedDescriptors.job.roleTrack && cvProfile.careerTrack && normalizeText(normalizedDescriptors.job.roleTrack).includes(normalizeText(cvProfile.careerTrack))
        ? 0.75
        : normalizedDescriptors.job.roleTrack || cvProfile.careerTrack
          ? 0.25
          : 0.5;
  if (careerTrackFit >= 0.75) matchedSignals.push('Career-track fit is strong.');
  else if (careerTrackFit <= 0.25) gapSignals.push('Career-track mismatch reduces fit.');

  const excludedDomainConflict = cvProfile.excludedDomains.find((domain) => includesText(jobText, domain));
  const excludedDomainScore = excludedDomainConflict ? 0 : jobText.trim().length > 0 ? 1 : 0.5;
  if (excludedDomainConflict) {
    penalties.push({
      code: 'excluded_domain_conflict',
      label: 'Excluded domain conflict',
      severity: 3,
      impact: -SUB_WEIGHTS.excluded_domain_conflict,
      reason: `The job appears to match the excluded domain "${excludedDomainConflict}".`,
    });
    hardSkipReasons.push(`Excluded domain conflict detected: ${excludedDomainConflict}.`);
  }

  let hardSkipApplied = false;
  const workSetupLevel = input.job.normalizedJobObject.workSetup === 'unknown'
    ? null
    : input.preferenceProfile.workSetupPreferences[input.job.normalizedJobObject.workSetup];
  const workSetupFit = workSetupLevel ? preferenceLevelToUnit(workSetupLevel) : 0.5;
  if (workSetupLevel === 'hard_skip' && input.job.normalizedJobObject.workSetup !== 'unknown') {
    hardSkipApplied = true;
    hardSkipReasons.push(`Work setup ${input.job.normalizedJobObject.workSetup} conflicts with a confirmed hard skip preference.`);
  }

  let locationFit = 0.5;
  if (input.job.normalizedJobObject.location) {
    const normalizedLocation = normalizeText(input.job.normalizedJobObject.location);
    const preferredLocation = input.preferenceProfile.preferredLocations.find((location) => normalizedLocation.includes(normalizeText(location)));
    const avoidedLocation = input.preferenceProfile.avoidedLocations.find((location) => normalizedLocation.includes(normalizeText(location)));
    const allowedCity = input.preferenceProfile.allowedOnSiteCities.some((city) => normalizedLocation.includes(normalizeText(city)));
    const allowedCountry = input.preferenceProfile.allowedOnSiteCountries.some((country) => normalizedLocation.includes(normalizeText(country)));
    locationFit =
      preferredLocation ? 1 :
      avoidedLocation ? 0 :
      allowedCity || allowedCountry ? 0.75 :
      input.preferenceProfile.strictLocationHandling && input.job.normalizedJobObject.workSetup === 'onsite' && (input.preferenceProfile.allowedOnSiteCities.length > 0 || input.preferenceProfile.allowedOnSiteCountries.length > 0)
        ? 0 : 0.5;
    if (
      input.preferenceProfile.strictLocationHandling &&
      input.job.normalizedJobObject.workSetup === 'onsite' &&
      !allowedCity &&
      !allowedCountry &&
      (input.preferenceProfile.allowedOnSiteCities.length > 0 || input.preferenceProfile.allowedOnSiteCountries.length > 0)
    ) {
      hardSkipApplied = true;
      hardSkipReasons.push(`Known on-site location ${input.job.normalizedJobObject.location} is outside the allowed set.`);
    }
  }

  const employmentTypeLevel = input.job.normalizedJobObject.employmentType === 'unknown'
    ? null
    : input.preferenceProfile.employmentTypePreferences[input.job.normalizedJobObject.employmentType];
  const employmentTypeFit = employmentTypeLevel ? preferenceLevelToUnit(employmentTypeLevel) : 0.5;
  if (employmentTypeLevel === 'hard_skip' && input.job.normalizedJobObject.employmentType !== 'unknown') {
    hardSkipApplied = true;
    hardSkipReasons.push(`Employment type ${input.job.normalizedJobObject.employmentType} conflicts with a confirmed hard skip preference.`);
  }

  const titleComparables = buildComparableTexts(input.job.normalizedJobObject.title, jobText, normalizedDescriptors.job.roleTrack);
  const preferredTitleMatches = findNormalizedMatches(normalizedDescriptors.preferences.preferredJobTitles, titleComparables);
  const avoidedTitleMatches = findNormalizedMatches(normalizedDescriptors.preferences.avoidedJobTitles, titleComparables);
  const preferredTrackMatches = findNormalizedMatches(normalizedDescriptors.preferences.preferredRoleTracks, titleComparables);
  const avoidedTrackMatches = findNormalizedMatches(normalizedDescriptors.preferences.avoidedRoleTracks, titleComparables);
  const titleOrTrackScore =
    (avoidedTitleMatches.length > 0 || avoidedTrackMatches.length > 0) ? 0 :
    (preferredTitleMatches.length > 0 || preferredTrackMatches.length > 0) ? 1 :
    (normalizedDescriptors.preferences.preferredJobTitles.length > 0 || normalizedDescriptors.preferences.preferredRoleTracks.length > 0) ? 0.25 : 0.5;
  if (preferredTitleMatches.length > 0 || preferredTrackMatches.length > 0) {
    matchedSignals.push(`Preferred title or role-track match: ${[...preferredTitleMatches, ...preferredTrackMatches].slice(0, 3).join(', ')}.`);
  }
  if (avoidedTitleMatches.length > 0 || avoidedTrackMatches.length > 0) {
    gapSignals.push(`Avoided title or role-track match: ${[...avoidedTitleMatches, ...avoidedTrackMatches].slice(0, 3).join(', ')}.`);
    penalties.push({
      code: 'avoided_title_or_track',
      label: 'Avoided title or role track',
      severity: 2,
      impact: -SUB_WEIGHTS.preferred_and_avoided_titles_or_role_tracks,
      reason: 'The job strongly conflicts with avoided titles or role tracks.',
    });
  }

  const preferredKeywordMatches = normalizedDescriptors.preferences.preferredKeywords.filter((keyword) => includesText(jobText, keyword));
  const requiredKeywordMatches = normalizedDescriptors.preferences.requiredKeywords.filter((keyword) => includesText(jobText, keyword));
  const avoidedKeywordMatches = normalizedDescriptors.preferences.avoidedKeywords.filter((keyword) => includesText(jobText, keyword));
  const extractionCompleteness = evidenceScores.find((entry) => entry.key === 'extraction_completeness')?.value ?? 0;
  const requiredKeywordRatio = normalizedDescriptors.preferences.requiredKeywords.length === 0
    ? 1
    : requiredKeywordMatches.length / normalizedDescriptors.preferences.requiredKeywords.length;
  let keywordScore =
    requiredKeywordRatio >= 0.75 ? 1 :
    requiredKeywordRatio >= 0.5 ? 0.75 :
    requiredKeywordRatio >= 0.25 ? 0.5 :
    requiredKeywordRatio > 0 ? 0.25 : 0.25;
  if (preferredKeywordMatches.length > 0) {
    keywordScore = Math.min(1, keywordScore + 0.25);
  }
  if (avoidedKeywordMatches.length > 0) {
    keywordScore = Math.max(0, keywordScore - 0.25);
    penalties.push({
      code: 'avoided_keyword',
      label: 'Avoided keyword',
      severity: 1,
      impact: -Math.min(SUB_WEIGHTS.preferred_required_and_avoided_keywords, avoidedKeywordMatches.length * 1.5),
      reason: `Avoided keywords matched: ${avoidedKeywordMatches.slice(0, 3).join(', ')}.`,
    });
  }
  if (normalizedDescriptors.preferences.requiredKeywords.length > 0 && requiredKeywordMatches.length === 0 && extractionCompleteness >= 0.75) {
    keywordScore = Math.min(keywordScore, 0.5);
  }
  if (preferredKeywordMatches.length > 0 || requiredKeywordMatches.length > 0) {
    matchedSignals.push(`Keyword evidence includes ${[...requiredKeywordMatches, ...preferredKeywordMatches].slice(0, 4).join(', ')}.`);
  }
  if (avoidedKeywordMatches.length > 0) {
    gapSignals.push(`Avoided keywords matched: ${avoidedKeywordMatches.slice(0, 3).join(', ')}.`);
  }

  if (input.preferenceProfile.preferGreenfield && input.job.normalizedJobObject.greenfieldSignal === true) {
    recommendationReasons.push('The role appears to include greenfield scope.');
  }
  if (input.preferenceProfile.preferHighOwnership && input.job.normalizedJobObject.highOwnershipSignal === true) {
    recommendationReasons.push('The role signals high ownership.');
  }
  if (input.preferenceProfile.scopePreferences.length > 0 && input.job.normalizedJobObject.scopeSignals.length > 0) {
    const scopeMatches = input.preferenceProfile.scopePreferences.filter((scope) =>
      input.job.normalizedJobObject.scopeSignals.some((signal) => normalizeText(signal).includes(normalizeText(scope))),
    );
    if (scopeMatches.length > 0) {
      recommendationReasons.push(`Scope preferences matched: ${scopeMatches.slice(0, 3).join(', ')}.`);
    }
  }

  const subcriteria: ScoredSubcriterion[] = [
    { key: 'role_alignment', value: roleAlignment, note: 'Primary role, secondary role, and role-family alignment.' },
    { key: 'skills_and_stack_match', value: skillsAndStackMatch, note: matchedSkills.length > 0 ? `Matched skills: ${matchedSkills.slice(0, 5).join(', ')}.` : 'No strong skills overlap was detected.' },
    { key: 'seniority_fit', value: seniorityFit, note: `CV seniority ${cvProfile.seniority}; job seniority ${jobSeniority}.` },
    { key: 'career_track_fit', value: careerTrackFit, note: `CV track ${cvProfile.careerTrack ?? 'unknown'}; job track ${normalizedDescriptors.job.roleTrack ?? 'unknown'}.` },
    { key: 'excluded_domain_conflict', value: excludedDomainScore, note: excludedDomainConflict ? `Excluded domain conflict: ${excludedDomainConflict}.` : 'No excluded-domain conflict was detected.' },
    { key: 'work_setup_fit', value: workSetupFit, note: workSetupLevel ? `Work setup preference level is ${workSetupLevel}.` : 'Work setup is unknown, so certainty is reduced instead of hard-skipping.' },
    { key: 'location_fit', value: locationFit, note: input.job.normalizedJobObject.location ? 'Location fit was scored from known location signals.' : 'Location is unknown, so certainty is reduced instead of hard-skipping.' },
    { key: 'employment_type_fit', value: employmentTypeFit, note: employmentTypeLevel ? `Employment type preference level is ${employmentTypeLevel}.` : 'Employment type is unknown, so certainty is reduced instead of hard-skipping.' },
    { key: 'preferred_and_avoided_titles_or_role_tracks', value: titleOrTrackScore, note: 'Preferred and avoided titles or role tracks were scored against normalized job signals.' },
    { key: 'preferred_required_and_avoided_keywords', value: clampUnit(keywordScore), note: 'Required keywords cap fit; preferred keywords help; avoided keywords reduce confidence.' },
    ...evidenceScores,
  ];

  const subcriterionScores = subcriteria.map(subcriterionToScore);
  const criterionScores = aggregateCriterionScores(subcriterionScores);
  const totalScore = roundScore(subcriterionScores.reduce((total, entry) => total + entry.score, 0));

  if (roleAlignment >= 0.75) recommendationReasons.push('This CV has the strongest role alignment.');
  if (skillsAndStackMatch >= 0.75) recommendationReasons.push('This CV covers the main skills and stack well.');
  if (seniorityFit <= 0.25) suggestedCvChanges.push(`Adjust positioning if this CV should target ${jobSeniority} roles.`);
  if (matchedSkills.length === 0 && cvProfile.coreStack.length > 0) suggestedCvChanges.push(`Clarify ${cvProfile.coreStack.slice(0, 3).join(', ')} if this CV should compete for similar roles.`);

  return {
    cvId: cvProfile.cvId,
    totalScore: hardSkipApplied ? 0 : roundScore(totalScore),
    criterionScores,
    subcriterionScores,
    appliedPenalties: penalties,
    hardSkipApplied,
    note: hardSkipApplied ? 'A PRD hard-skip rule applied because a conflicting job attribute was explicitly known.' : 'CV scored against the PRD-weighted evaluation model.',
    matchedSignals: unique(matchedSignals),
    gapSignals: unique([...gapSignals, ...hardSkipReasons]),
    recommendationReasons: unique(recommendationReasons),
    suggestedCvChanges: unique(suggestedCvChanges),
    hardSkipReasons: unique(hardSkipReasons),
    penalties,
  };
}

function buildExplanationSourceFields(
  job: EvaluationInput['job'],
  cvProfile: CVProfile | null,
  preferenceProfile: PreferenceProfile,
  usedInferredCompanyOrSectorSignal: boolean,
): EvaluationResult['explanationSourceFields'] {
  return {
    jobFields: unique([
      ...(job.normalizedJobObject.title ? ['title'] : []),
      ...(job.normalizedJobObject.company ? ['company'] : []),
      ...(job.normalizedJobObject.description ? ['description'] : []),
      ...(job.normalizedJobObject.location ? ['location'] : []),
      ...(job.normalizedJobObject.workSetup !== 'unknown' ? ['workSetup'] : []),
      ...(job.normalizedJobObject.employmentType !== 'unknown' ? ['employmentType'] : []),
      ...(job.normalizedJobObject.companySector ? ['companySector'] : []),
      ...(job.normalizedJobObject.companyType ? ['companyType'] : []),
      ...(job.normalizedJobObject.keywords.length > 0 ? ['keywords'] : []),
      ...(job.normalizedJobObject.scopeSignals.length > 0 ? ['scopeSignals'] : []),
    ]),
    cvFields: cvProfile
      ? unique([
          ...(cvProfile.primaryRole ? ['primaryRole'] : []),
          ...(cvProfile.secondaryRoles.length > 0 ? ['secondaryRoles'] : []),
          ...(cvProfile.careerTrack ? ['careerTrack'] : []),
          ...(cvProfile.coreStack.length > 0 ? ['coreStack'] : []),
          ...(cvProfile.positioningSummary ? ['positioningSummary'] : []),
          ...(cvProfile.excludedDomains.length > 0 ? ['excludedDomains'] : []),
          'seniority',
        ])
      : [],
    preferenceFields: unique([
      'workSetupPreferences',
      'employmentTypePreferences',
      'preferredLocations',
      'avoidedLocations',
      'strictLocationHandling',
      'preferredRoleTracks',
      'avoidedRoleTracks',
      'preferredJobTitles',
      'avoidedJobTitles',
      'preferredSectors',
      'avoidedSectors',
      'preferredCompanyTypes',
      'avoidedCompanyTypes',
      'preferredKeywords',
      'requiredKeywords',
      'avoidedKeywords',
      'preferredSeniorityRange',
      'scopePreferences',
      ...(preferenceProfile.preferGreenfield ? ['preferGreenfield'] : []),
      ...(preferenceProfile.preferHighOwnership ? ['preferHighOwnership'] : []),
    ]),
    usedInferredCompanyOrSectorSignal,
  };
}

function buildReviewRequiredEvaluation(
  input: EvaluationInput,
  reasons: string[],
  version: string,
  scoringVersion: string,
  reviewGateStatus: 'review_required' | 'failed',
  normalizedComparisonDescriptors: EvaluationResult['normalizedComparisonDescriptors'],
): EvaluationResult {
  const unknownDataFlags = computeUnknownDataFlags(input.job);
  const validation = validateExtraction({
    sourceIdentifier: input.job.sourceIdentifier,
    sourceUrl: input.job.sourceUrl ?? '',
    rawCaptureContent: input.job.rawCaptureContent ?? '',
    extractionCandidate: {
      title: input.job.normalizedJobObject.title,
      company: input.job.normalizedJobObject.company,
      location: input.job.normalizedJobObject.location,
      workSetup: input.job.normalizedJobObject.workSetup,
      employmentType: input.job.normalizedJobObject.employmentType,
      description: input.job.normalizedJobObject.description,
      recruiterOrPosterSignal: input.job.normalizedJobObject.recruiterOrPosterSignal,
      companySector: input.job.normalizedJobObject.companySector,
      companyType: input.job.normalizedJobObject.companyType,
      keywords: input.job.normalizedJobObject.keywords,
    },
    sourceConfidenceHints: [],
    ambiguityFlags: [],
    extractionNotes: [],
  });
  const evidenceScore = scoreEvidenceStrength(input.job, validation)
    .map(subcriterionToScore)
    .reduce((total, entry) => total + entry.score, 0);
  const informationQualityScore = roundScore((evidenceScore / MAIN_WEIGHTS.evidence_strength) * 100);

  return {
    id: createId('eval'),
    jobId: input.job.id,
    evaluatedCvResults: [],
    recommendedCvId: null,
    verdict: null,
    totalScore: null,
    criterionScores: [],
    subcriterionScores: [],
    appliedPenalties: [],
    hardSkipApplied: false,
    reviewGateStatus,
    evaluationVersion: version,
    scoringVersion,
    extractionVersion: input.job.extractionVersion,
    informationQualityScore,
    unknownDataFlags,
    explanationEvidencePayload: {
      matchedSignals: [],
      gapSignals: unique(reasons),
      hardSkipReasons: [],
      recommendationReasons: ['Review is required before the model can produce a final verdict.'],
    },
    explanationSourceFields: buildExplanationSourceFields(input.job, null, input.preferenceProfile, false),
    normalizedComparisonDescriptors,
    decisionTrace: buildDecisionTrace(input.job.extractionConfidence, informationQualityScore, reviewGateStatus),
    aiArtifactReferences: [],
    conciseExplanation: 'Review required before verdict generation.',
    majorGapsSummary: unique(reasons),
    detailedExplanation: reasons.join(' '),
    suggestedCvChanges: [],
    nextAction: buildEvaluationNextAction({
      reviewGateStatus,
      verdict: null,
      recommendedCvId: null,
      majorGapsSummary: unique(reasons),
    }),
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function evaluateJob(input: EvaluationInput, version = 'evaluation-v2', scoringVersion = 'scoring-v2'): EvaluationResult {
  const normalizedPreferenceProfile = normalizePreferenceProfile(input.preferenceProfile);
  const jobText = joinNonEmpty([
    input.job.normalizedJobObject.title,
    input.job.normalizedJobObject.company,
    input.job.normalizedJobObject.description,
    input.job.normalizedJobObject.companySector,
    input.job.normalizedJobObject.companyType,
    input.job.normalizedJobObject.keywords.join(' '),
  ]);
  const inferredCompanySignals = inferCompanySignals(
    jobText,
    input.job.normalizedJobObject.companySector,
    input.job.normalizedJobObject.companyType,
  );
  const normalizedComparisonDescriptors = buildNormalizedComparisonDescriptors(
    input.job,
    input.preferenceProfile,
    normalizedPreferenceProfile.evaluationReady.normalizedTextLists,
    inferredCompanySignals,
  );

  const validation = validateExtraction({
    sourceIdentifier: input.job.sourceIdentifier,
    sourceUrl: input.job.sourceUrl ?? '',
    rawCaptureContent: input.job.rawCaptureContent ?? '',
    extractionCandidate: {
      title: input.job.normalizedJobObject.title,
      company: input.job.normalizedJobObject.company,
      location: input.job.normalizedJobObject.location,
      workSetup: input.job.normalizedJobObject.workSetup,
      employmentType: input.job.normalizedJobObject.employmentType,
      description: input.job.normalizedJobObject.description,
      recruiterOrPosterSignal: input.job.normalizedJobObject.recruiterOrPosterSignal,
      companySector: input.job.normalizedJobObject.companySector,
      companyType: input.job.normalizedJobObject.companyType,
      keywords: input.job.normalizedJobObject.keywords,
    },
    sourceConfidenceHints: [],
    ambiguityFlags: [],
    extractionNotes: [],
  });

  if (input.reviewGateStatus !== 'proceed' || validation.status !== 'proceed') {
    return buildReviewRequiredEvaluation(
      input,
      validation.reasons.length > 0 ? validation.reasons : ['Extraction confidence is too low for a reliable verdict.'],
      version,
      scoringVersion,
      input.reviewGateStatus !== 'proceed' ? input.reviewGateStatus : validation.status === 'failed' ? 'failed' : 'review_required',
      normalizedComparisonDescriptors,
    );
  }

  const evidenceScores = scoreEvidenceStrength(input.job, validation);
  const comparisons = input.cvProfiles.map((profile) => scoreCvComparison(profile, input, normalizedComparisonDescriptors, evidenceScores));
  const sorted = [...comparisons].sort((left, right) => {
    if (left.hardSkipApplied !== right.hardSkipApplied) return Number(left.hardSkipApplied) - Number(right.hardSkipApplied);
    if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
    const leftCvToRole = left.criterionScores.find((criterion) => criterion.criterion === 'cv_to_role_match')?.score ?? 0;
    const rightCvToRole = right.criterionScores.find((criterion) => criterion.criterion === 'cv_to_role_match')?.score ?? 0;
    if (rightCvToRole !== leftCvToRole) return rightCvToRole - leftCvToRole;
    const leftSkills = left.subcriterionScores.find((criterion) => criterion.subcriterion === 'skills_and_stack_match')?.score ?? 0;
    const rightSkills = right.subcriterionScores.find((criterion) => criterion.subcriterion === 'skills_and_stack_match')?.score ?? 0;
    if (rightSkills !== leftSkills) return rightSkills - leftSkills;
    const leftRole = left.subcriterionScores.find((criterion) => criterion.subcriterion === 'role_alignment')?.score ?? 0;
    const rightRole = right.subcriterionScores.find((criterion) => criterion.subcriterion === 'role_alignment')?.score ?? 0;
    if (rightRole !== leftRole) return rightRole - leftRole;
    const leftPrefs = left.criterionScores.find((criterion) => criterion.criterion === 'user_preference_fit')?.score ?? 0;
    const rightPrefs = right.criterionScores.find((criterion) => criterion.criterion === 'user_preference_fit')?.score ?? 0;
    if (rightPrefs !== leftPrefs) return rightPrefs - leftPrefs;
    if (input.preferredCvId) {
      const leftPreferred = left.cvId === input.preferredCvId;
      const rightPreferred = right.cvId === input.preferredCvId;
      if (leftPreferred !== rightPreferred) {
        return Number(rightPreferred) - Number(leftPreferred);
      }
    }
    return left.cvId.localeCompare(right.cvId);
  });

  const recommended = sorted[0] ?? null;
  const verdict: Verdict | null = !recommended
    ? null
    : recommended.hardSkipApplied
      ? 'skip'
      : recommended.totalScore >= 75
        ? 'apply'
        : recommended.totalScore >= 55
          ? 'consider'
          : 'skip';

  const unknownDataFlags = computeUnknownDataFlags(input.job);
  const evidenceStrengthScore = recommended?.criterionScores.find((criterion) => criterion.criterion === 'evidence_strength')?.score ?? 0;
  const informationQualityScore = roundScore((evidenceStrengthScore / MAIN_WEIGHTS.evidence_strength) * 100);
  const recommendedProfile = recommended ? input.cvProfiles.find((profile) => profile.cvId === recommended.cvId) ?? null : null;
  const explanationEvidencePayload: EvaluationEvidencePayload = {
    matchedSignals: recommended ? unique(recommended.matchedSignals) : [],
    gapSignals: recommended ? unique(recommended.gapSignals) : ['No CVs were available for evaluation.'],
    hardSkipReasons: recommended ? unique(recommended.hardSkipReasons) : [],
    recommendationReasons: recommended ? unique(recommended.recommendationReasons) : ['No CVs were available for evaluation.'],
  };
  const majorGapsSummary = recommended ? unique(recommended.gapSignals).slice(0, 4) : ['No CVs were available for evaluation.'];
  const conciseExplanation = recommended
    ? `${Math.round(recommended.totalScore)}/100 fit. ${recommended.recommendationReasons[0] ?? 'This CV produced the strongest PRD-weighted fit score.'}`
    : 'No CVs were available for evaluation.';
  const detailedExplanation = recommended
    ? [
        `Recommended CV: ${recommended.cvId}.`,
        `Criterion scores: ${recommended.criterionScores.map((criterion) => `${criterion.criterion}=${criterion.score}/${criterion.maxScore}`).join(', ')}.`,
        recommended.appliedPenalties.length > 0
          ? `Penalties: ${recommended.appliedPenalties.map((penalty) => penalty.label).join(', ')}.`
          : 'No penalties were applied.',
        majorGapsSummary.length > 0 ? `Major gaps: ${majorGapsSummary.join(', ')}.` : 'No major gaps were surfaced.',
      ].join(' ')
    : 'No CVs were available for evaluation.';

  return {
    id: createId('eval'),
    jobId: input.job.id,
    evaluatedCvResults: sorted.map((comparison): EvaluatedCvResult => ({
      cvId: comparison.cvId,
      totalScore: comparison.totalScore,
      hardSkipApplied: comparison.hardSkipApplied,
      criterionScores: comparison.criterionScores,
      subcriterionScores: comparison.subcriterionScores,
      appliedPenalties: comparison.appliedPenalties,
      note: comparison.note,
    })),
    recommendedCvId: recommended?.cvId ?? null,
    verdict,
    totalScore: recommended?.totalScore ?? null,
    criterionScores: recommended?.criterionScores ?? [],
    subcriterionScores: recommended?.subcriterionScores ?? [],
    appliedPenalties: recommended?.appliedPenalties ?? [],
    hardSkipApplied: Boolean(recommended?.hardSkipApplied),
    reviewGateStatus: 'proceed',
    evaluationVersion: version,
    scoringVersion,
    extractionVersion: input.job.extractionVersion,
    informationQualityScore,
    unknownDataFlags,
    explanationEvidencePayload,
    explanationSourceFields: buildExplanationSourceFields(input.job, recommendedProfile, input.preferenceProfile, inferredCompanySignals.used),
    normalizedComparisonDescriptors,
    decisionTrace: buildDecisionTrace(input.job.extractionConfidence, informationQualityScore, 'proceed'),
    aiArtifactReferences: [],
    conciseExplanation,
    majorGapsSummary,
    detailedExplanation,
    suggestedCvChanges: recommended ? unique(recommended.suggestedCvChanges) : [],
    nextAction: buildEvaluationNextAction({
      reviewGateStatus: 'proceed',
      verdict,
      recommendedCvId: recommended?.cvId ?? null,
      majorGapsSummary,
    }),
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
