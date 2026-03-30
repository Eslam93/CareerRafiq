import { describe, expect, it } from 'vitest';
import type { CVProfile, PreferenceProfile } from '@career-rafiq/contracts';
import { buildSmartDefaultPreferenceProfile, normalizePreferenceProfile } from './preferences.js';

function makeCvProfile(id: string, values: Partial<CVProfile> = {}): CVProfile {
  return {
    id: `cvp_${id}`,
    userId: 'usr_1',
    cvId: `cv_${id}`,
    cvName: `${id}.pdf`,
    primaryRole: 'Backend Engineer',
    secondaryRoles: ['Software Engineer'],
    seniority: 'senior',
    careerTrack: 'IC Engineering',
    coreStack: ['python', 'fastapi', 'aws'],
    positioningSummary: 'senior backend role',
    excludedDomains: [],
    inferredValues: {},
    confirmedValues: {},
    overrideValues: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...values,
  };
}

function makePreferenceProfile(values: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    id: 'pref_1',
    userId: 'usr_1',
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
    preferredSeniorityRange: {
      minimum: 'mid',
      maximum: 'staff',
    },
    scopePreferences: ['ownership'],
    preferGreenfield: false,
    preferHighOwnership: true,
    allowedOnSiteCountries: [],
    allowedOnSiteCities: [],
    preferredLocations: ['Cairo', 'Remote'],
    avoidedLocations: [],
    preferredRoleTracks: ['IC Engineering'],
    avoidedRoleTracks: [],
    preferredJobTitles: ['Backend Engineer'],
    avoidedJobTitles: [],
    preferredSectors: [],
    avoidedSectors: [],
    preferredCompanyTypes: [],
    avoidedCompanyTypes: [],
    preferredKeywords: ['NodeJS', 'Machine-Learning'],
    requiredKeywords: ['n/a'],
    avoidedKeywords: ['node.js'],
    inferredValues: {
      preferredKeywords: ['NodeJS'],
      preferredLocations: ['Remote'],
    },
    confirmedValues: {
      preferredKeywords: ['Machine-Learning'],
      preferredLocations: ['Cairo'],
    },
    overrideValues: {
      preferredKeywords: ['NodeJS'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...values,
  };
}

describe('buildSmartDefaultPreferenceProfile', () => {
  it('builds defaults from CV profiles with inferred lists populated', () => {
    const profile = buildSmartDefaultPreferenceProfile({
      userId: 'usr_1',
      cvProfiles: [
        makeCvProfile('1', { primaryRole: 'Backend Engineer', careerTrack: 'IC Engineering', coreStack: ['python', 'aws'] }),
        makeCvProfile('2', { primaryRole: 'Platform Engineer', careerTrack: 'Platform', coreStack: ['terraform', 'aws'] }),
      ],
      clock: () => new Date('2026-02-01T00:00:00.000Z'),
    });

    expect(profile.workSetupPreferences.remote).toBe('top');
    expect(profile.employmentTypePreferences.full_time).toBe('top');
    expect(profile.preferredRoleTracks).toEqual(['IC Engineering', 'Platform']);
    expect(profile.preferredJobTitles).toEqual(['Backend Engineer', 'Platform Engineer']);
    expect(profile.preferredKeywords).toEqual(['python', 'aws', 'terraform']);
    expect(profile.inferredValues).toMatchObject({
      preferredRoleTracks: ['IC Engineering', 'Platform'],
      preferredJobTitles: ['Backend Engineer', 'Platform Engineer'],
    });
  });
});

describe('normalizePreferenceProfile', () => {
  it('keeps user-entered values immutable while producing normalized descriptors', () => {
    const input = makePreferenceProfile({
      preferredKeywords: ['NodeJS', 'node.js', 'backend engineer', 'backend engineers'],
      preferredLocations: [' Cairo ', 'Cairo'],
      avoidedLocations: ['remote'],
      requiredKeywords: ['n/a'],
      avoidedKeywords: ['Node.js'],
    });

    const originalKeywords = [...input.preferredKeywords];
    const result = normalizePreferenceProfile(input);

    expect(input.preferredKeywords).toEqual(originalKeywords);
    expect(result.profile.preferredKeywords).toEqual(originalKeywords);
    expect(result.evaluationReady.normalizedTextLists.preferredKeywords).toEqual([
      'node.js',
      'backend engineer',
      'backend engineers',
    ]);
    expect(result.descriptors.some((item) => item.field === 'preferredKeywords' && item.rawValue === 'NodeJS' && item.normalizedValue === 'node.js')).toBe(true);
  });

  it('flags duplicate, near-duplicate, contradiction, and weak-value audit issues', () => {
    const result = normalizePreferenceProfile(
      makePreferenceProfile({
        preferredKeywords: ['NodeJS', 'node.js', 'backend engineer', 'backend engineers'],
        avoidedKeywords: ['node.js'],
        requiredKeywords: ['n/a'],
      }),
    );

    expect(result.audits.some((audit) => audit.type === 'duplicate' && audit.fields.includes('preferredKeywords'))).toBe(true);
    expect(result.audits.some((audit) => audit.type === 'near_duplicate' && audit.fields.includes('preferredKeywords'))).toBe(true);
    expect(result.audits.some((audit) => audit.type === 'contradiction' && audit.fields.includes('preferredKeywords') && audit.fields.includes('avoidedKeywords'))).toBe(true);
    expect(result.audits.some((audit) => audit.type === 'weak_value' && audit.fields.includes('requiredKeywords'))).toBe(true);
  });

  it('marks value sources with override > confirmed > inferred precedence', () => {
    const result = normalizePreferenceProfile(
      makePreferenceProfile({
        preferredKeywords: ['NodeJS', 'Machine-Learning', 'terraform'],
        inferredValues: { preferredKeywords: ['NodeJS', 'terraform'] },
        confirmedValues: { preferredKeywords: ['Machine-Learning', 'terraform'] },
        overrideValues: { preferredKeywords: ['NodeJS'] },
      }),
    );

    expect(result.evaluationReady.valueSources.preferredKeywords['node.js']).toBe('overridden');
    expect(result.evaluationReady.valueSources.preferredKeywords['machine learning']).toBe('confirmed');
    expect(result.evaluationReady.valueSources.preferredKeywords['terraform']).toBe('confirmed');
  });
});
