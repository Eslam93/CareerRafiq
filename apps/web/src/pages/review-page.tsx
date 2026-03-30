import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EmploymentType, PreferenceLevel, PreferenceProfile, Seniority, UpdateCvProfileRequest, WorkSetup } from '@career-rafiq/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useCurrentSetupQuery,
  useMagicLinkRequestMutation,
  useRefreshSetupSuggestionsMutation,
  useSetDefaultCvMutation,
  useUpdateCvProfileMutation,
  useUpdatePreferencesMutation,
} from '../api-hooks.js';
import { webApiClient } from '../api-client.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { webRoutes } from '../route-paths.js';
import { TokenListInput } from '../components/token-list-input.js';
import { toErrorMessage } from '../utils/text.js';

const seniorityOptions: Seniority[] = [
  'intern',
  'junior',
  'mid',
  'senior',
  'staff',
  'lead',
  'manager',
  'director',
  'executive',
  'unknown',
];

const preferenceLevels: PreferenceLevel[] = ['top', 'ok', 'neutral', 'not_recommended', 'hard_skip'];
const workSetupOptions: Array<Exclude<WorkSetup, 'unknown'>> = ['remote', 'hybrid', 'onsite'];
const employmentTypeOptions: Array<Exclude<EmploymentType, 'unknown'>> = [
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'temporary',
  'internship',
];

function PreferenceLevelSelect(props: {
  value: PreferenceLevel;
  onChange: (value: PreferenceLevel) => void;
}) {
  return (
    <select value={props.value} onChange={(event) => props.onChange(event.target.value as PreferenceLevel)}>
      {preferenceLevels.map((option) => (
        <option key={option} value={option}>
          {option.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  );
}

function ReadinessPill(props: { tone: 'good' | 'warning' | 'neutral'; label: string; value: string }) {
  return (
    <div className={`pill pill--${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

type ReviewState = 'inferred' | 'confirmed' | 'overridden';
type ReviewableCvField = Extract<keyof UpdateCvProfileRequest, string>;
type ReviewablePreferenceField = Extract<keyof PreferenceProfile, string>;

interface ReviewFieldSummary {
  key: string;
  label: string;
  state: ReviewState;
  currentDisplay: string;
  suggestedDisplay: string | null;
  hasPendingSuggestion: boolean;
}

function hasOwnValue(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean).map((value) => value.toLowerCase()))].sort();
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify(normalizeList(left.map(String))) === JSON.stringify(normalizeList(right.map(String)));
  }
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

function cloneReviewValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }
  if (value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>) } as T;
  }
  return value;
}

function formatReviewValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'None';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => `${key}: ${String(entryValue)}`);
    return entries.length > 0 ? entries.join(' | ') : 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (value === null || typeof value === 'undefined' || value === '') {
    return 'None';
  }
  return String(value);
}

function deriveReviewState(
  confirmedValues: Record<string, unknown>,
  overrideValues: Record<string, unknown>,
  key: string,
): ReviewState {
  if (hasOwnValue(overrideValues, key)) {
    return 'overridden';
  }
  if (hasOwnValue(confirmedValues, key)) {
    return 'confirmed';
  }
  return 'inferred';
}

function buildReviewFieldSummary(
  key: string,
  label: string,
  currentValue: unknown,
  inferredValues: Record<string, unknown>,
  confirmedValues: Record<string, unknown>,
  overrideValues: Record<string, unknown>,
): ReviewFieldSummary {
  const suggestedValue = inferredValues[key];
  const state = deriveReviewState(confirmedValues, overrideValues, key);
  const hasPendingSuggestion = state === 'inferred' && typeof suggestedValue !== 'undefined' && !valuesEqual(currentValue, suggestedValue);
  return {
    key,
    label,
    state,
    currentDisplay: formatReviewValue(currentValue),
    suggestedDisplay: typeof suggestedValue === 'undefined' ? null : formatReviewValue(suggestedValue),
    hasPendingSuggestion,
  };
}

export function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const setupQuery = useCurrentSetupQuery();
  const bootstrap = setupQuery.data?.bootstrap ?? null;
  const cvProfiles = bootstrap?.cvProfiles ?? [];
  const [selectedCvId, setSelectedCvId] = useState<string>('');
  const selectedCvProfile = cvProfiles.find((profile) => profile.cvId === selectedCvId) ?? cvProfiles[0] ?? null;

  const updateCvProfileMutation = useUpdateCvProfileMutation(selectedCvProfile?.cvId ?? '');
  const updatePreferencesMutation = useUpdatePreferencesMutation();
  const requestMagicLinkMutation = useMagicLinkRequestMutation();
  const refreshSuggestionsMutation = useRefreshSetupSuggestionsMutation();
  const setDefaultCvMutation = useSetDefaultCvMutation();
  const trackedUserIdRef = useRef<string | null>(null);

  const [cvName, setCvName] = useState('');
  const [primaryRole, setPrimaryRole] = useState('');
  const [secondaryRoles, setSecondaryRoles] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<Seniority>('unknown');
  const [careerTrack, setCareerTrack] = useState('');
  const [coreStack, setCoreStack] = useState<string[]>([]);
  const [positioningSummary, setPositioningSummary] = useState('');
  const [excludedDomains, setExcludedDomains] = useState<string[]>([]);

  const [strictLocationHandling, setStrictLocationHandling] = useState(false);
  const [preferredSeniorityMinimum, setPreferredSeniorityMinimum] = useState<Seniority | ''>('');
  const [preferredSeniorityMaximum, setPreferredSeniorityMaximum] = useState<Seniority | ''>('');
  const [scopePreferences, setScopePreferences] = useState<string[]>([]);
  const [preferGreenfield, setPreferGreenfield] = useState(false);
  const [preferHighOwnership, setPreferHighOwnership] = useState(false);
  const [allowedOnSiteCountries, setAllowedOnSiteCountries] = useState<string[]>([]);
  const [allowedOnSiteCities, setAllowedOnSiteCities] = useState<string[]>([]);
  const [preferredLocations, setPreferredLocations] = useState<string[]>([]);
  const [avoidedLocations, setAvoidedLocations] = useState<string[]>([]);
  const [preferredRoleTracks, setPreferredRoleTracks] = useState<string[]>([]);
  const [avoidedRoleTracks, setAvoidedRoleTracks] = useState<string[]>([]);
  const [preferredJobTitles, setPreferredJobTitles] = useState<string[]>([]);
  const [avoidedJobTitles, setAvoidedJobTitles] = useState<string[]>([]);
  const [preferredSectors, setPreferredSectors] = useState<string[]>([]);
  const [avoidedSectors, setAvoidedSectors] = useState<string[]>([]);
  const [preferredCompanyTypes, setPreferredCompanyTypes] = useState<string[]>([]);
  const [avoidedCompanyTypes, setAvoidedCompanyTypes] = useState<string[]>([]);
  const [preferredKeywords, setPreferredKeywords] = useState<string[]>([]);
  const [requiredKeywords, setRequiredKeywords] = useState<string[]>([]);
  const [avoidedKeywords, setAvoidedKeywords] = useState<string[]>([]);
  const [workSetupPreferences, setWorkSetupPreferences] = useState<Record<Exclude<WorkSetup, 'unknown'>, PreferenceLevel>>({
    remote: 'top',
    hybrid: 'ok',
    onsite: 'neutral',
  });
  const [employmentTypePreferences, setEmploymentTypePreferences] = useState<Record<Exclude<EmploymentType, 'unknown'>, PreferenceLevel>>({
    full_time: 'top',
    part_time: 'neutral',
    contract: 'neutral',
    freelance: 'neutral',
    temporary: 'neutral',
    internship: 'neutral',
  });

  const [magicLinkEmail, setMagicLinkEmail] = useState('');

  useEffect(() => {
    const requestedCvId = searchParams.get('cvId');
    const requestedProfile = requestedCvId ? cvProfiles.find((profile) => profile.cvId === requestedCvId) : null;
    if (requestedProfile && requestedProfile.cvId !== selectedCvId) {
      setSelectedCvId(requestedProfile.cvId);
      return;
    }

    const firstProfile = cvProfiles[0];
    if (!firstProfile) {
      if (selectedCvId) {
        setSelectedCvId('');
      }
      return;
    }

    if (!selectedCvId || !cvProfiles.some((profile) => profile.cvId === selectedCvId)) {
      setSelectedCvId(firstProfile.cvId);
    }
  }, [cvProfiles, searchParams, selectedCvId]);

  useEffect(() => {
    if (!selectedCvProfile) return;
    setCvName(selectedCvProfile.cvName);
    setPrimaryRole(selectedCvProfile.primaryRole ?? '');
    setSecondaryRoles(selectedCvProfile.secondaryRoles);
    setSeniority(selectedCvProfile.seniority);
    setCareerTrack(selectedCvProfile.careerTrack ?? '');
    setCoreStack(selectedCvProfile.coreStack);
    setPositioningSummary(selectedCvProfile.positioningSummary);
    setExcludedDomains(selectedCvProfile.excludedDomains);
  }, [selectedCvProfile]);

  useEffect(() => {
    if (!bootstrap) return;
    setStrictLocationHandling(bootstrap.preferenceProfile.strictLocationHandling);
    setPreferredSeniorityMinimum(bootstrap.preferenceProfile.preferredSeniorityRange.minimum ?? '');
    setPreferredSeniorityMaximum(bootstrap.preferenceProfile.preferredSeniorityRange.maximum ?? '');
    setScopePreferences(bootstrap.preferenceProfile.scopePreferences);
    setPreferGreenfield(bootstrap.preferenceProfile.preferGreenfield);
    setPreferHighOwnership(bootstrap.preferenceProfile.preferHighOwnership);
    setAllowedOnSiteCountries(bootstrap.preferenceProfile.allowedOnSiteCountries);
    setAllowedOnSiteCities(bootstrap.preferenceProfile.allowedOnSiteCities);
    setPreferredLocations(bootstrap.preferenceProfile.preferredLocations);
    setAvoidedLocations(bootstrap.preferenceProfile.avoidedLocations);
    setPreferredRoleTracks(bootstrap.preferenceProfile.preferredRoleTracks);
    setAvoidedRoleTracks(bootstrap.preferenceProfile.avoidedRoleTracks);
    setPreferredJobTitles(bootstrap.preferenceProfile.preferredJobTitles);
    setAvoidedJobTitles(bootstrap.preferenceProfile.avoidedJobTitles);
    setPreferredSectors(bootstrap.preferenceProfile.preferredSectors);
    setAvoidedSectors(bootstrap.preferenceProfile.avoidedSectors);
    setPreferredCompanyTypes(bootstrap.preferenceProfile.preferredCompanyTypes);
    setAvoidedCompanyTypes(bootstrap.preferenceProfile.avoidedCompanyTypes);
    setPreferredKeywords(bootstrap.preferenceProfile.preferredKeywords);
    setRequiredKeywords(bootstrap.preferenceProfile.requiredKeywords);
    setAvoidedKeywords(bootstrap.preferenceProfile.avoidedKeywords);
    setWorkSetupPreferences(bootstrap.preferenceProfile.workSetupPreferences);
    setEmploymentTypePreferences(bootstrap.preferenceProfile.employmentTypePreferences);
    setMagicLinkEmail(bootstrap.user.email ?? bootstrap.selectedEmailCandidate ?? bootstrap.detectedEmails[0] ?? '');
  }, [bootstrap]);

  useEffect(() => {
    if (!bootstrap?.user.id || trackedUserIdRef.current === bootstrap.user.id) {
      return;
    }
    trackedUserIdRef.current = bootstrap.user.id;
    void webApiClient.trackAnalyticsEvent('setup_review_opened');
  }, [bootstrap]);

  const preferenceListFields = useMemo(() => ([
    {
      label: 'Allowed on-site countries',
      values: allowedOnSiteCountries,
      onChange: setAllowedOnSiteCountries,
      hint: 'Only used when on-site location matters.',
    },
    {
      label: 'Allowed on-site cities',
      values: allowedOnSiteCities,
      onChange: setAllowedOnSiteCities,
    },
    {
      label: 'Preferred locations',
      values: preferredLocations,
      onChange: setPreferredLocations,
    },
    {
      label: 'Avoided locations',
      values: avoidedLocations,
      onChange: setAvoidedLocations,
    },
    {
      label: 'Preferred role tracks',
      values: preferredRoleTracks,
      onChange: setPreferredRoleTracks,
    },
    {
      label: 'Avoided role tracks',
      values: avoidedRoleTracks,
      onChange: setAvoidedRoleTracks,
    },
    {
      label: 'Preferred job titles',
      values: preferredJobTitles,
      onChange: setPreferredJobTitles,
    },
    {
      label: 'Avoided job titles',
      values: avoidedJobTitles,
      onChange: setAvoidedJobTitles,
    },
    {
      label: 'Preferred sectors',
      values: preferredSectors,
      onChange: setPreferredSectors,
    },
    {
      label: 'Avoided sectors',
      values: avoidedSectors,
      onChange: setAvoidedSectors,
    },
    {
      label: 'Preferred company types',
      values: preferredCompanyTypes,
      onChange: setPreferredCompanyTypes,
    },
    {
      label: 'Avoided company types',
      values: avoidedCompanyTypes,
      onChange: setAvoidedCompanyTypes,
    },
    {
      label: 'Preferred keywords',
      values: preferredKeywords,
      onChange: setPreferredKeywords,
    },
    {
      label: 'Required keywords',
      values: requiredKeywords,
      onChange: setRequiredKeywords,
      hint: 'Use sparingly for must-have signals.',
    },
    {
      label: 'Avoided keywords',
      values: avoidedKeywords,
      onChange: setAvoidedKeywords,
    },
  ]), [
    allowedOnSiteCities,
    allowedOnSiteCountries,
    avoidedCompanyTypes,
    avoidedJobTitles,
    avoidedKeywords,
    avoidedLocations,
    avoidedRoleTracks,
    avoidedSectors,
    preferredCompanyTypes,
    preferredJobTitles,
    preferredKeywords,
    preferredLocations,
    preferredRoleTracks,
    preferredSectors,
    requiredKeywords,
  ]);

  const currentCvProfilePatch = useMemo(() => {
    if (!selectedCvProfile) {
      return null;
    }
    return {
      cvName: cvName.trim() || selectedCvProfile.cvName,
      primaryRole: primaryRole.trim() || null,
      secondaryRoles,
      seniority,
      careerTrack: careerTrack.trim() || null,
      coreStack,
      positioningSummary: positioningSummary.trim(),
      excludedDomains,
    } satisfies UpdateCvProfileRequest;
  }, [
    careerTrack,
    coreStack,
    cvName,
    excludedDomains,
    positioningSummary,
    primaryRole,
    secondaryRoles,
    selectedCvProfile,
    seniority,
  ]);

  const currentPreferenceProfile = useMemo(() => {
    if (!bootstrap) {
      return null;
    }
    return {
      ...bootstrap.preferenceProfile,
      strictLocationHandling,
      workSetupPreferences,
      employmentTypePreferences,
      preferredSeniorityRange: {
        minimum: preferredSeniorityMinimum || null,
        maximum: preferredSeniorityMaximum || null,
      },
      scopePreferences,
      preferGreenfield,
      preferHighOwnership,
      allowedOnSiteCountries,
      allowedOnSiteCities,
      preferredLocations,
      avoidedLocations,
      preferredRoleTracks,
      avoidedRoleTracks,
      preferredJobTitles,
      avoidedJobTitles,
      preferredSectors,
      avoidedSectors,
      preferredCompanyTypes,
      avoidedCompanyTypes,
      preferredKeywords,
      requiredKeywords,
      avoidedKeywords,
    } satisfies PreferenceProfile;
  }, [
    allowedOnSiteCities,
    allowedOnSiteCountries,
    avoidedCompanyTypes,
    avoidedJobTitles,
    avoidedKeywords,
    avoidedLocations,
    avoidedRoleTracks,
    avoidedSectors,
    bootstrap,
    employmentTypePreferences,
    preferGreenfield,
    preferHighOwnership,
    preferredCompanyTypes,
    preferredJobTitles,
    preferredKeywords,
    preferredLocations,
    preferredRoleTracks,
    preferredSectors,
    preferredSeniorityMaximum,
    preferredSeniorityMinimum,
    requiredKeywords,
    scopePreferences,
    strictLocationHandling,
    workSetupPreferences,
  ]);

  const cvReviewFields = useMemo(() => {
    if (!selectedCvProfile || !currentCvProfilePatch) {
      return [] as ReviewFieldSummary[];
    }
    return [
      buildReviewFieldSummary('cvName', 'CV name', currentCvProfilePatch.cvName, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
      buildReviewFieldSummary('primaryRole', 'Primary role', currentCvProfilePatch.primaryRole, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
      buildReviewFieldSummary('secondaryRoles', 'Secondary roles', currentCvProfilePatch.secondaryRoles, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
      buildReviewFieldSummary('seniority', 'Seniority', currentCvProfilePatch.seniority, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
      buildReviewFieldSummary('careerTrack', 'Career track', currentCvProfilePatch.careerTrack, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
      buildReviewFieldSummary('coreStack', 'Core stack', currentCvProfilePatch.coreStack, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
      buildReviewFieldSummary('positioningSummary', 'Positioning summary', currentCvProfilePatch.positioningSummary, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
      buildReviewFieldSummary('excludedDomains', 'Excluded domains', currentCvProfilePatch.excludedDomains, selectedCvProfile.inferredValues, selectedCvProfile.confirmedValues, selectedCvProfile.overrideValues),
    ];
  }, [currentCvProfilePatch, selectedCvProfile]);

  const preferenceReviewFields = useMemo(() => {
    if (!bootstrap || !currentPreferenceProfile) {
      return [] as ReviewFieldSummary[];
    }
    const confirmedValues = bootstrap.preferenceProfile.confirmedValues;
    const overrideValues = bootstrap.preferenceProfile.overrideValues;
    const inferredValues = bootstrap.preferenceProfile.inferredValues;
    return [
      buildReviewFieldSummary('strictLocationHandling', 'Strict location handling', currentPreferenceProfile.strictLocationHandling, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferredSeniorityRange', 'Preferred seniority range', currentPreferenceProfile.preferredSeniorityRange, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('scopePreferences', 'Scope preferences', currentPreferenceProfile.scopePreferences, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferGreenfield', 'Prefer greenfield', currentPreferenceProfile.preferGreenfield, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferHighOwnership', 'Prefer high ownership', currentPreferenceProfile.preferHighOwnership, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('workSetupPreferences', 'Work setup preferences', currentPreferenceProfile.workSetupPreferences, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('employmentTypePreferences', 'Employment type preferences', currentPreferenceProfile.employmentTypePreferences, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('allowedOnSiteCountries', 'Allowed on-site countries', currentPreferenceProfile.allowedOnSiteCountries, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('allowedOnSiteCities', 'Allowed on-site cities', currentPreferenceProfile.allowedOnSiteCities, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferredLocations', 'Preferred locations', currentPreferenceProfile.preferredLocations, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('avoidedLocations', 'Avoided locations', currentPreferenceProfile.avoidedLocations, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferredRoleTracks', 'Preferred role tracks', currentPreferenceProfile.preferredRoleTracks, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('avoidedRoleTracks', 'Avoided role tracks', currentPreferenceProfile.avoidedRoleTracks, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferredJobTitles', 'Preferred job titles', currentPreferenceProfile.preferredJobTitles, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('avoidedJobTitles', 'Avoided job titles', currentPreferenceProfile.avoidedJobTitles, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferredSectors', 'Preferred sectors', currentPreferenceProfile.preferredSectors, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('avoidedSectors', 'Avoided sectors', currentPreferenceProfile.avoidedSectors, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferredCompanyTypes', 'Preferred company types', currentPreferenceProfile.preferredCompanyTypes, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('avoidedCompanyTypes', 'Avoided company types', currentPreferenceProfile.avoidedCompanyTypes, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('preferredKeywords', 'Preferred keywords', currentPreferenceProfile.preferredKeywords, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('requiredKeywords', 'Required keywords', currentPreferenceProfile.requiredKeywords, inferredValues, confirmedValues, overrideValues),
      buildReviewFieldSummary('avoidedKeywords', 'Avoided keywords', currentPreferenceProfile.avoidedKeywords, inferredValues, confirmedValues, overrideValues),
    ];
  }, [bootstrap, currentPreferenceProfile]);

  async function handleCvProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentCvProfilePatch) return;
    await updateCvProfileMutation.mutateAsync(currentCvProfilePatch);
  }

  async function handlePreferenceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPreferenceProfile) return;
    await updatePreferencesMutation.mutateAsync({
      preferenceProfile: currentPreferenceProfile,
      reevaluateTrackedJobs: true,
    });
  }

  async function persistCvFieldDecision(field: ReviewableCvField, mode: 'accept' | 'keep_current') {
    if (!selectedCvProfile || !currentCvProfilePatch) {
      return;
    }
    const nextPatch = {
      ...currentCvProfilePatch,
    } as Record<string, unknown>;
    if (mode === 'accept' && typeof selectedCvProfile.inferredValues[field] !== 'undefined') {
      nextPatch[field] = cloneReviewValue(selectedCvProfile.inferredValues[field]);
    }
    await updateCvProfileMutation.mutateAsync(nextPatch as unknown as UpdateCvProfileRequest);
  }

  async function persistPreferenceFieldDecision(field: ReviewablePreferenceField, mode: 'accept' | 'keep_current') {
    if (!bootstrap || !currentPreferenceProfile) {
      return;
    }
    const nextProfile = {
      ...currentPreferenceProfile,
    } as Record<string, unknown>;
    if (mode === 'accept' && typeof bootstrap.preferenceProfile.inferredValues[field] !== 'undefined') {
      nextProfile[field] = cloneReviewValue(bootstrap.preferenceProfile.inferredValues[field]);
    }
    await updatePreferencesMutation.mutateAsync({
      preferenceProfile: nextProfile as unknown as PreferenceProfile,
      reevaluateTrackedJobs: true,
    });
  }

  async function handleMagicLinkRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!magicLinkEmail.trim()) return;
    await requestMagicLinkMutation.mutateAsync(magicLinkEmail.trim());
  }

  async function handleDefaultCvSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCvId) return;
    await setDefaultCvMutation.mutateAsync({ cvId: selectedCvId, reevaluateTrackedJobs: true });
  }

  async function handleRefreshSuggestions() {
    await refreshSuggestionsMutation.mutateAsync({ reevaluateTrackedJobs: true });
  }

  function handleSelectedCvChange(nextCvId: string) {
    setSelectedCvId(nextCvId);
    const nextParams = new URLSearchParams(searchParams);
    if (nextCvId) {
      nextParams.set('cvId', nextCvId);
    } else {
      nextParams.delete('cvId');
    }
    setSearchParams(nextParams, { replace: true });
  }

  const defaultCvName =
    cvProfiles.find((profile) => profile.cvId === bootstrap?.user.defaultCvId)?.cvName
    ?? bootstrap?.cvs.find((cv) => cv.id === bootstrap?.user.defaultCvId)?.fileName
    ?? bootstrap?.user.defaultCvId
    ?? 'Not set';

  return (
    <div className="page-stack">
      <PageSection title="Setup overview" subtitle="Confirm that identity, CV positioning, and preferences are strong enough before capture and evaluation.">
        <QueryState
          isLoading={setupQuery.isLoading}
          errorMessage={setupQuery.error ? toErrorMessage(setupQuery.error) : null}
          loadingLabel="Loading setup review payload..."
        />
        {!setupQuery.isLoading && !bootstrap ? <p>No setup data exists in the current session.</p> : null}
        {bootstrap ? (
          <div className="stack">
            <div className="pill-grid">
              <ReadinessPill tone={bootstrap.emailCollectionRequired ? 'warning' : 'good'} label="Email" value={bootstrap.user.email ?? 'Needed'} />
              <ReadinessPill tone={bootstrap.returnAccessRequiresVerification ? 'warning' : 'good'} label="Return access" value={bootstrap.returnAccessRequiresVerification ? 'Verify link' : 'Ready'} />
              <ReadinessPill tone={bootstrap.minimumUsableDataReady ? 'good' : 'warning'} label="Minimum setup" value={bootstrap.minimumUsableDataReady ? 'Ready' : 'Blocked'} />
              <ReadinessPill tone={bootstrap.setupAiArtifacts.length > 0 ? 'good' : 'neutral'} label="AI suggestions" value={`${bootstrap.setupAiArtifacts.length} artifact(s)`} />
            </div>

            <div className="panel-grid">
              <article className="card card--compact">
                <div className="stack">
                  <p><strong>Selected email candidate:</strong> {bootstrap.selectedEmailCandidate ?? 'None detected'}</p>
                  <p><strong>Email conflict detected:</strong> {bootstrap.emailConflictDetected ? 'Yes' : 'No'}</p>
                  <p><strong>Detected emails:</strong> {bootstrap.detectedEmails.join(', ') || 'None'}</p>
                </div>
              </article>
              <article className="card card--compact">
                <div className="stack">
                  <p><strong>CV profiles:</strong> {bootstrap.cvProfiles.length}</p>
                  <p><strong>Default CV:</strong> {defaultCvName}</p>
                  <p><strong>Preference audits:</strong> {bootstrap.preferenceAudits.length}</p>
                </div>
              </article>
            </div>

            {bootstrap.setupWarnings.length > 0 ? (
              <div className="callout callout--warning">
                <strong>Setup warnings</strong>
                <ul className="simple-list">
                  {bootstrap.setupWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {bootstrap.setupAiArtifacts.length > 0 ? (
              <div className="callout callout--neutral">
                <strong>Latest AI setup artifacts</strong>
                <ul className="simple-list">
                  {bootstrap.setupAiArtifacts.map((artifact) => (
                    <li key={artifact.id}>
                      {artifact.stepType} | {artifact.status} | {Math.round(artifact.overallConfidence * 100)}% confidence
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="button-row">
              <button type="button" onClick={handleRefreshSuggestions} disabled={refreshSuggestionsMutation.isPending}>
                {refreshSuggestionsMutation.isPending ? 'Refreshing suggestions...' : 'Refresh AI suggestions'}
              </button>
            </div>
            <QueryState
              isLoading={refreshSuggestionsMutation.isPending}
              errorMessage={refreshSuggestionsMutation.error ? toErrorMessage(refreshSuggestionsMutation.error) : null}
              loadingLabel="Refreshing setup suggestions..."
            />
            {refreshSuggestionsMutation.data?.reevaluatedJobIds.length ? (
              <p className="muted">Reevaluated jobs after suggestion refresh: {refreshSuggestionsMutation.data.reevaluatedJobIds.join(', ')}</p>
            ) : null}
          </div>
        ) : null}
      </PageSection>

      <PageSection title="CV positioning" subtitle="Each CV stays editable and job-specific. Keep the profile crisp so the recommender can separate your variants cleanly.">
        {cvProfiles.length === 0 ? (
          <p>No CV profiles available yet.</p>
        ) : (
          <div className="stack">
            <div className="callout callout--neutral">
              <strong>Use the CV manager for library actions.</strong>
              <p className="muted">Browse all CVs, inspect version history, upload a new CV, or replace an existing one through the dedicated manager.</p>
              <div className="button-row">
                <Link className="button button--ghost" to={webRoutes.cvs}>
                  Open CV manager
                </Link>
              </div>
            </div>
            {selectedCvProfile ? (
              <div className="callout callout--neutral">
                <strong>Field provenance</strong>
                <ul className="simple-list">
                  {cvReviewFields.map((field) => (
                    <li key={field.key}>
                      {field.label}: {field.state}
                      {field.hasPendingSuggestion ? ` | current: ${field.currentDisplay} | suggested: ${field.suggestedDisplay ?? 'None'}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {cvReviewFields.some((field) => field.hasPendingSuggestion) ? (
              <div className="stack">
                <div className="callout callout--warning">
                  <strong>Pending CV suggestions</strong>
                  <p className="muted">Accept or keep the current value. Each action saves the current form state immediately.</p>
                </div>
                <div className="panel-grid">
                  {cvReviewFields.filter((field) => field.hasPendingSuggestion).map((field) => (
                    <article key={field.key} className="card card--compact">
                      <strong>{field.label}</strong>
                      <p className="muted">Current: {field.currentDisplay}</p>
                      <p className="muted">Suggested: {field.suggestedDisplay ?? 'None'}</p>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => void persistCvFieldDecision(field.key as ReviewableCvField, 'accept')}
                          disabled={updateCvProfileMutation.isPending}
                        >
                          Accept suggestion
                        </button>
                        <button
                          type="button"
                          onClick={() => void persistCvFieldDecision(field.key as ReviewableCvField, 'keep_current')}
                          disabled={updateCvProfileMutation.isPending}
                        >
                          Keep current value
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <form className="form-grid" onSubmit={handleCvProfileSubmit}>
              <label className="field">
                <span>Active CV profile</span>
                <select value={selectedCvProfile?.cvId ?? ''} onChange={(event) => handleSelectedCvChange(event.target.value)}>
                  {cvProfiles.map((profile) => (
                    <option key={profile.id} value={profile.cvId}>
                      {profile.cvName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>CV name</span>
                <input value={cvName} onChange={(event) => setCvName(event.target.value)} />
              </label>
              <label className="field">
                <span>Primary role</span>
                <input value={primaryRole} onChange={(event) => setPrimaryRole(event.target.value)} />
              </label>
              <label className="field">
                <span>Seniority</span>
                <select value={seniority} onChange={(event) => setSeniority(event.target.value as Seniority)}>
                  {seniorityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Career track</span>
                <input value={careerTrack} onChange={(event) => setCareerTrack(event.target.value)} />
              </label>
              <label className="field field--full">
                <span>Positioning summary</span>
                <textarea value={positioningSummary} rows={4} onChange={(event) => setPositioningSummary(event.target.value)} />
              </label>
              <TokenListInput label="Secondary roles" values={secondaryRoles} onChange={setSecondaryRoles} hint="Keep this focused to adjacent roles you actually want this CV to support." />
              <TokenListInput label="Core stack" values={coreStack} onChange={setCoreStack} hint="These signals strongly affect recommendation quality." />
              <TokenListInput label="Excluded domains" values={excludedDomains} onChange={setExcludedDomains} hint="Use only for domains you truly want to filter out." />
              <button type="submit" disabled={!selectedCvProfile || updateCvProfileMutation.isPending}>
                {updateCvProfileMutation.isPending ? 'Saving profile...' : 'Save CV profile'}
              </button>
            </form>

            <form className="form-grid" onSubmit={handleDefaultCvSubmit}>
              <label className="field">
                <span>Default CV for tie-breaks</span>
                <select value={selectedCvId} onChange={(event) => handleSelectedCvChange(event.target.value)}>
                  {cvProfiles.map((profile) => (
                    <option key={profile.cvId} value={profile.cvId}>
                      {profile.cvName}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={setDefaultCvMutation.isPending || !selectedCvId}>
                {setDefaultCvMutation.isPending ? 'Updating default CV...' : 'Set default CV'}
              </button>
            </form>
          </div>
        )}

        <QueryState
          isLoading={updateCvProfileMutation.isPending || setDefaultCvMutation.isPending}
          errorMessage={
            (updateCvProfileMutation.error ? toErrorMessage(updateCvProfileMutation.error) : null) ??
            (setDefaultCvMutation.error ? toErrorMessage(setDefaultCvMutation.error) : null)
          }
          loadingLabel="Saving CV setup changes..."
        />
        {updateCvProfileMutation.data?.reevaluatedJobIds.length ? (
          <p className="muted">Reevaluated jobs after CV update: {updateCvProfileMutation.data.reevaluatedJobIds.join(', ')}</p>
        ) : null}
      </PageSection>

      <PageSection title="Global preferences" subtitle="Use clear preferences and constraints. Free-text values stay editable, but the product now treats them as discrete entries instead of CSV blobs.">
        {bootstrap ? (
          <div className="stack">
            <div className="callout callout--neutral">
              <strong>Field provenance</strong>
              <ul className="simple-list">
                {preferenceReviewFields.map((field) => (
                  <li key={field.key}>
                    {field.label}: {field.state}
                    {field.hasPendingSuggestion ? ` | current: ${field.currentDisplay} | suggested: ${field.suggestedDisplay ?? 'None'}` : ''}
                  </li>
                ))}
              </ul>
            </div>

            {preferenceReviewFields.some((field) => field.hasPendingSuggestion) ? (
              <div className="stack">
                <div className="callout callout--warning">
                  <strong>Pending preference suggestions</strong>
                  <p className="muted">Accept or keep the current value. Each action saves the current form state immediately.</p>
                </div>
                <div className="panel-grid">
                  {preferenceReviewFields.filter((field) => field.hasPendingSuggestion).map((field) => (
                    <article key={field.key} className="card card--compact">
                      <strong>{field.label}</strong>
                      <p className="muted">Current: {field.currentDisplay}</p>
                      <p className="muted">Suggested: {field.suggestedDisplay ?? 'None'}</p>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => void persistPreferenceFieldDecision(field.key as ReviewablePreferenceField, 'accept')}
                          disabled={updatePreferencesMutation.isPending}
                        >
                          Accept suggestion
                        </button>
                        <button
                          type="button"
                          onClick={() => void persistPreferenceFieldDecision(field.key as ReviewablePreferenceField, 'keep_current')}
                          disabled={updatePreferencesMutation.isPending}
                        >
                          Keep current value
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <form className="form-grid" onSubmit={handlePreferenceSubmit}>
              <label className="field field--checkbox">
                <input type="checkbox" checked={strictLocationHandling} onChange={(event) => setStrictLocationHandling(event.target.checked)} />
                <span>Use strict location handling for on-site roles</span>
              </label>

              <div className="preference-grid">
                <label className="field">
                  <span>Minimum preferred seniority</span>
                  <select value={preferredSeniorityMinimum} onChange={(event) => setPreferredSeniorityMinimum(event.target.value as Seniority | '')}>
                    <option value="">No minimum</option>
                    {seniorityOptions.filter((option) => option !== 'unknown').map((option) => (
                      <option key={`minimum-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Maximum preferred seniority</span>
                  <select value={preferredSeniorityMaximum} onChange={(event) => setPreferredSeniorityMaximum(event.target.value as Seniority | '')}>
                    <option value="">No maximum</option>
                    {seniorityOptions.filter((option) => option !== 'unknown').map((option) => (
                      <option key={`maximum-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <TokenListInput
                label="Scope preferences"
                values={scopePreferences}
                onChange={setScopePreferences}
                hint="Examples: ownership, platform breadth, IC depth, stakeholder exposure."
              />

              <label className="field field--checkbox">
                <input type="checkbox" checked={preferGreenfield} onChange={(event) => setPreferGreenfield(event.target.checked)} />
                <span>Prefer greenfield work when available</span>
              </label>

              <label className="field field--checkbox">
                <input type="checkbox" checked={preferHighOwnership} onChange={(event) => setPreferHighOwnership(event.target.checked)} />
                <span>Prefer high-ownership roles</span>
              </label>

              {preferenceListFields.map((field) => (
                <TokenListInput
                  key={field.label}
                  label={field.label}
                  values={field.values}
                  onChange={field.onChange}
                  hint={field.hint}
                />
              ))}

              <div className="preference-grid">
                {workSetupOptions.map((option) => (
                  <label key={option} className="field">
                    <span>{option.replaceAll('_', ' ')} work setup</span>
                    <PreferenceLevelSelect
                      value={workSetupPreferences[option]}
                      onChange={(value) =>
                        setWorkSetupPreferences((current) => ({
                          ...current,
                          [option]: value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>

              <div className="preference-grid">
                {employmentTypeOptions.map((option) => (
                  <label key={option} className="field">
                    <span>{option.replaceAll('_', ' ')} employment</span>
                    <PreferenceLevelSelect
                      value={employmentTypePreferences[option]}
                      onChange={(value) =>
                        setEmploymentTypePreferences((current) => ({
                          ...current,
                          [option]: value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>

              <button type="submit" disabled={updatePreferencesMutation.isPending}>
                {updatePreferencesMutation.isPending ? 'Saving preferences...' : 'Save preferences'}
              </button>
            </form>
          </div>
        ) : (
          <p>Setup data is required before preferences can be edited.</p>
        )}

        <QueryState
          isLoading={updatePreferencesMutation.isPending}
          errorMessage={updatePreferencesMutation.error ? toErrorMessage(updatePreferencesMutation.error) : null}
          loadingLabel="Saving preferences..."
        />
        {updatePreferencesMutation.data?.reevaluatedJobIds.length ? (
          <p className="muted">Reevaluated jobs after preference update: {updatePreferencesMutation.data.reevaluatedJobIds.join(', ')}</p>
        ) : null}
        {updatePreferencesMutation.data?.audits.length ? (
          <div className="callout callout--neutral">
            <strong>Preference audit suggestions</strong>
            <ul className="simple-list">
              {updatePreferencesMutation.data.audits.map((audit, index) => (
                <li key={`${audit.type}-${index}`}>
                  [{audit.severity}] {audit.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PageSection>

      <PageSection title="Return access" subtitle="Keep your current session active now, but verify email return access before relying on the tracker long-term.">
        <form className="form-grid" onSubmit={handleMagicLinkRequest}>
          <label className="field">
            <span>Email for return access</span>
            <input type="email" value={magicLinkEmail} onChange={(event) => setMagicLinkEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          <button type="submit" disabled={requestMagicLinkMutation.isPending || magicLinkEmail.trim().length === 0}>
            {requestMagicLinkMutation.isPending ? 'Sending...' : 'Send magic link'}
          </button>
        </form>
        <QueryState
          isLoading={requestMagicLinkMutation.isPending}
          errorMessage={requestMagicLinkMutation.error ? toErrorMessage(requestMagicLinkMutation.error) : null}
          loadingLabel="Sending magic link..."
        />
        {requestMagicLinkMutation.data ? (
          <div className="callout callout--success">
            Magic link sent to {requestMagicLinkMutation.data.sentTo}. If SMTP is disabled during beta, use the Ops page to inspect the latest outbox record.
          </div>
        ) : null}
      </PageSection>
    </div>
  );
}
