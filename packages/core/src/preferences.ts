import type { CVProfile, PreferenceLevel, PreferenceProfile, Seniority } from '@career-rafiq/contracts';
import { SENIORITY_ORDER, createId, nowIso, unique } from './helpers.js';

type TextListField =
  | 'scopePreferences'
  | 'allowedOnSiteCountries'
  | 'allowedOnSiteCities'
  | 'preferredLocations'
  | 'avoidedLocations'
  | 'preferredRoleTracks'
  | 'avoidedRoleTracks'
  | 'preferredJobTitles'
  | 'avoidedJobTitles'
  | 'preferredSectors'
  | 'avoidedSectors'
  | 'preferredCompanyTypes'
  | 'avoidedCompanyTypes'
  | 'preferredKeywords'
  | 'requiredKeywords'
  | 'avoidedKeywords';

export type PreferenceValueSource = 'inferred' | 'confirmed' | 'overridden';
export type PreferenceAuditIssueType = 'duplicate' | 'near_duplicate' | 'contradiction' | 'weak_value';

export interface PreferenceNormalizationDescriptor {
  field: TextListField;
  rawValue: string;
  normalizedValue: string;
  tokens: string[];
  source: PreferenceValueSource;
}

export interface PreferenceAuditIssue {
  type: PreferenceAuditIssueType;
  severity: 'info' | 'warning';
  fields: TextListField[];
  values: string[];
  normalizedValues: string[];
  message: string;
}

export interface EvaluationReadyPreferenceProfile {
  strictLocationHandling: boolean;
  workSetupPreferences: PreferenceProfile['workSetupPreferences'];
  employmentTypePreferences: PreferenceProfile['employmentTypePreferences'];
  preferredSeniorityRange: PreferenceProfile['preferredSeniorityRange'];
  scopePreferences: string[];
  preferGreenfield: boolean;
  preferHighOwnership: boolean;
  normalizedTextLists: Record<TextListField, string[]>;
  valueSources: Record<TextListField, Record<string, PreferenceValueSource>>;
}

export interface PreferenceNormalizationResult {
  profile: PreferenceProfile;
  descriptors: PreferenceNormalizationDescriptor[];
  audits: PreferenceAuditIssue[];
  evaluationReady: EvaluationReadyPreferenceProfile;
}

export interface BuildPreferenceProfileInput {
  userId: string;
  cvProfiles: CVProfile[];
  clock?: () => Date;
}

const TEXT_FIELDS: readonly TextListField[] = [
  'scopePreferences',
  'allowedOnSiteCountries',
  'allowedOnSiteCities',
  'preferredLocations',
  'avoidedLocations',
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
];

const CONTRADICTION_PAIRS: ReadonlyArray<[TextListField, TextListField]> = [
  ['preferredLocations', 'avoidedLocations'],
  ['preferredRoleTracks', 'avoidedRoleTracks'],
  ['preferredJobTitles', 'avoidedJobTitles'],
  ['preferredSectors', 'avoidedSectors'],
  ['preferredCompanyTypes', 'avoidedCompanyTypes'],
  ['preferredKeywords', 'avoidedKeywords'],
  ['requiredKeywords', 'avoidedKeywords'],
];

const WEAK_VALUES = new Set(['n/a', 'na', 'none', 'all', 'any', 'whatever', 'anywhere', 'everywhere', 'misc']);

const ALIAS_TABLE: Readonly<Record<string, string>> = {
  'c sharp': 'c#',
  csharp: 'c#',
  'dot net': '.net',
  dotnet: '.net',
  nodejs: 'node.js',
  node: 'node.js',
  'node js': 'node.js',
  'machine-learning': 'machine learning',
  ml: 'machine learning',
  genai: 'generative ai',
  'full stack': 'full-stack',
  fullstack: 'full-stack',
  onsite: 'on-site',
  inoffice: 'on-site',
};

function extractStringArray(record: Record<string, unknown>, key: string): string[] {
  const raw = record[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string');
}

function normalizeValue(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9.+#/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ALIAS_TABLE[cleaned] ?? cleaned;
}

function tokenize(value: string): string[] {
  return normalizeValue(value).split(' ').filter(Boolean);
}

function copyProfile(profile: PreferenceProfile): PreferenceProfile {
  return {
    ...profile,
    workSetupPreferences: { ...profile.workSetupPreferences },
    employmentTypePreferences: { ...profile.employmentTypePreferences },
    preferredSeniorityRange: { ...profile.preferredSeniorityRange },
    scopePreferences: [...profile.scopePreferences],
    allowedOnSiteCountries: [...profile.allowedOnSiteCountries],
    allowedOnSiteCities: [...profile.allowedOnSiteCities],
    preferredLocations: [...profile.preferredLocations],
    avoidedLocations: [...profile.avoidedLocations],
    preferredRoleTracks: [...profile.preferredRoleTracks],
    avoidedRoleTracks: [...profile.avoidedRoleTracks],
    preferredJobTitles: [...profile.preferredJobTitles],
    avoidedJobTitles: [...profile.avoidedJobTitles],
    preferredSectors: [...profile.preferredSectors],
    avoidedSectors: [...profile.avoidedSectors],
    preferredCompanyTypes: [...profile.preferredCompanyTypes],
    avoidedCompanyTypes: [...profile.avoidedCompanyTypes],
    preferredKeywords: [...profile.preferredKeywords],
    requiredKeywords: [...profile.requiredKeywords],
    avoidedKeywords: [...profile.avoidedKeywords],
    inferredValues: { ...profile.inferredValues },
    confirmedValues: { ...profile.confirmedValues },
    overrideValues: { ...profile.overrideValues },
  };
}

function getValueSource(profile: PreferenceProfile, field: TextListField, rawValue: string): PreferenceValueSource {
  const normalized = normalizeValue(rawValue);
  const overrides = extractStringArray(profile.overrideValues, field).map(normalizeValue);
  if (overrides.includes(normalized)) return 'overridden';
  const confirmed = extractStringArray(profile.confirmedValues, field).map(normalizeValue);
  if (confirmed.includes(normalized)) return 'confirmed';
  return 'inferred';
}

function normalizedUnique(values: readonly string[]): string[] {
  return unique(values.map(normalizeValue));
}

function seniorityRank(value: Seniority | null): number {
  if (!value || value === 'unknown') {
    return -1;
  }
  return SENIORITY_ORDER.indexOf(value);
}

function inferPreferredSeniorityRange(cvProfiles: CVProfile[]): PreferenceProfile['preferredSeniorityRange'] {
  const ranks = cvProfiles
    .map((profile) => seniorityRank(profile.seniority))
    .filter((rank) => rank >= 0);
  if (ranks.length === 0) {
    return {
      minimum: null,
      maximum: null,
    };
  }

  const minimumRank = Math.min(...ranks);
  const maximumRank = Math.max(...ranks);
  return {
    minimum: SENIORITY_ORDER[minimumRank] ?? null,
    maximum: SENIORITY_ORDER[maximumRank] ?? null,
  };
}

function stringSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[rows - 1]![cols - 1]!;
}

function isWeakValue(normalized: string): boolean {
  if (normalized.length <= 1) return true;
  return WEAK_VALUES.has(normalized);
}

function getFieldValues(profile: PreferenceProfile, field: TextListField): string[] {
  return profile[field];
}

function createAudit(
  type: PreferenceAuditIssueType,
  fields: TextListField[],
  rawValues: string[],
  normalizedValues: string[],
  message: string,
  severity: 'info' | 'warning' = 'warning',
): PreferenceAuditIssue {
  return {
    type,
    severity,
    fields,
    values: unique(rawValues),
    normalizedValues: unique(normalizedValues),
    message,
  };
}

function hasNearDuplicate(values: string[], target: string): string | null {
  for (const value of values) {
    if (value === target) continue;
    const score = stringSimilarity(value, target);
    if (score >= 0.86) return value;
  }
  return null;
}

export function buildSmartDefaultPreferenceProfile(input: BuildPreferenceProfileInput): PreferenceProfile {
  const clock = input.clock ?? (() => new Date());
  const preferredRoleTracks = unique(input.cvProfiles.map((profile) => profile.careerTrack ?? '').filter(Boolean));
  const preferredJobTitles = unique(input.cvProfiles.map((profile) => profile.primaryRole ?? '').filter(Boolean));
  const preferredKeywords = unique(input.cvProfiles.flatMap((profile) => profile.coreStack));
  return {
    id: createId('pref'),
    userId: input.userId,
    strictLocationHandling: false,
    workSetupPreferences: { remote: 'top', hybrid: 'ok', onsite: 'neutral' },
    employmentTypePreferences: {
      full_time: 'top',
      part_time: 'not_recommended',
      contract: 'ok',
      freelance: 'not_recommended',
      temporary: 'not_recommended',
      internship: 'not_recommended',
    },
    preferredSeniorityRange: inferPreferredSeniorityRange(input.cvProfiles),
    scopePreferences: [],
    preferGreenfield: false,
    preferHighOwnership: false,
    allowedOnSiteCountries: [],
    allowedOnSiteCities: [],
    preferredLocations: [],
    avoidedLocations: [],
    preferredRoleTracks,
    avoidedRoleTracks: [],
    preferredJobTitles,
    avoidedJobTitles: [],
    preferredSectors: [],
    avoidedSectors: [],
    preferredCompanyTypes: [],
    avoidedCompanyTypes: [],
    preferredKeywords,
    requiredKeywords: [],
    avoidedKeywords: [],
    inferredValues: {
      preferredSeniorityRange: inferPreferredSeniorityRange(input.cvProfiles),
      scopePreferences: [],
      preferGreenfield: false,
      preferHighOwnership: false,
      preferredRoleTracks,
      preferredJobTitles,
      preferredKeywords,
      workSetupPreferences: { remote: 'top', hybrid: 'ok', onsite: 'neutral' satisfies PreferenceLevel },
      employmentTypePreferences: {
        full_time: 'top',
        part_time: 'not_recommended',
        contract: 'ok',
        freelance: 'not_recommended',
        temporary: 'not_recommended',
        internship: 'not_recommended',
      } satisfies PreferenceProfile['employmentTypePreferences'],
    },
    confirmedValues: {},
    overrideValues: {},
    createdAt: nowIso(clock),
    updatedAt: nowIso(clock),
  };
}

export function normalizePreferenceProfile(profileInput: PreferenceProfile): PreferenceNormalizationResult {
  const profile = copyProfile(profileInput);
  const descriptors: PreferenceNormalizationDescriptor[] = [];
  const audits: PreferenceAuditIssue[] = [];
  const normalizedTextLists = TEXT_FIELDS.reduce(
    (acc, field) => {
      acc[field] = [];
      return acc;
    },
    {} as Record<TextListField, string[]>,
  );
  const valueSources = TEXT_FIELDS.reduce(
    (acc, field) => {
      acc[field] = {};
      return acc;
    },
    {} as Record<TextListField, Record<string, PreferenceValueSource>>,
  );

  for (const field of TEXT_FIELDS) {
    const rawValues = getFieldValues(profile, field);
    const normalizedValues = rawValues.map(normalizeValue).filter(Boolean);
    normalizedTextLists[field] = unique(normalizedValues);

    const seen = new Map<string, string>();
    for (const rawValue of rawValues) {
      const normalizedValue = normalizeValue(rawValue);
      if (!normalizedValue) continue;
      const source = getValueSource(profile, field, rawValue);
      descriptors.push({
        field,
        rawValue,
        normalizedValue,
        tokens: tokenize(rawValue),
        source,
      });
      valueSources[field][normalizedValue] = source;

      if (isWeakValue(normalizedValue)) {
        audits.push(
          createAudit(
            'weak_value',
            [field],
            [rawValue],
            [normalizedValue],
            `Weak value detected in ${field}: "${rawValue}".`,
            'info',
          ),
        );
      }

      const previous = seen.get(normalizedValue);
      if (previous) {
        audits.push(
          createAudit(
            'duplicate',
            [field],
            [previous, rawValue],
            [normalizedValue],
            `Duplicate values detected in ${field}.`,
          ),
        );
      } else {
        seen.set(normalizedValue, rawValue);
      }

      const near = hasNearDuplicate(normalizedUnique(rawValues), normalizedValue);
      if (near && near !== normalizedValue) {
        audits.push(
          createAudit(
            'near_duplicate',
            [field],
            [rawValue],
            [normalizedValue, near],
            `Near-duplicate values detected in ${field}.`,
            'info',
          ),
        );
      }
    }
  }

  for (const [leftField, rightField] of CONTRADICTION_PAIRS) {
    const leftValues = new Set(normalizedTextLists[leftField]);
    const rightValues = new Set(normalizedTextLists[rightField]);
    const overlaps = [...leftValues].filter((value) => rightValues.has(value));
    if (overlaps.length > 0) {
      audits.push(
        createAudit(
          'contradiction',
          [leftField, rightField],
          overlaps,
          overlaps,
          `Contradictory values exist across ${leftField} and ${rightField}.`,
        ),
      );
    }
  }

  const minRank = seniorityRank(profile.preferredSeniorityRange.minimum);
  const maxRank = seniorityRank(profile.preferredSeniorityRange.maximum);
  if (minRank >= 0 && maxRank >= 0 && minRank > maxRank) {
    audits.push(
      createAudit(
        'contradiction',
        ['scopePreferences'],
        [
          profile.preferredSeniorityRange.minimum ?? '',
          profile.preferredSeniorityRange.maximum ?? '',
        ],
        [
          profile.preferredSeniorityRange.minimum ?? '',
          profile.preferredSeniorityRange.maximum ?? '',
        ],
        'Preferred seniority range is inverted; minimum is above maximum.',
      ),
    );
  }

  const evaluationReady: EvaluationReadyPreferenceProfile = {
    strictLocationHandling: profile.strictLocationHandling,
    workSetupPreferences: { ...profile.workSetupPreferences },
    employmentTypePreferences: { ...profile.employmentTypePreferences },
    preferredSeniorityRange: { ...profile.preferredSeniorityRange },
    scopePreferences: normalizedTextLists.scopePreferences,
    preferGreenfield: profile.preferGreenfield,
    preferHighOwnership: profile.preferHighOwnership,
    normalizedTextLists,
    valueSources,
  };

  return {
    profile,
    descriptors,
    audits: dedupeAudits(audits),
    evaluationReady,
  };
}

function dedupeAudits(audits: PreferenceAuditIssue[]): PreferenceAuditIssue[] {
  const map = new Map<string, PreferenceAuditIssue>();
  for (const issue of audits) {
    const key = `${issue.type}|${issue.fields.join(',')}|${issue.normalizedValues.join(',')}`;
    if (!map.has(key)) {
      map.set(key, issue);
    }
  }
  return [...map.values()];
}
