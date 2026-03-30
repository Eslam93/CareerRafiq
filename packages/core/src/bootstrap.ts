import type { CV, CVProfile, PreferenceProfile, SetupBootstrapRequest, SetupBootstrapResponse, User } from '@career-rafiq/contracts';
import {
  buildPositioningSummary,
  createId,
  extractEmails,
  inferCareerTrack,
  inferCoreStack,
  inferExcludedDomains,
  inferPrimaryRole,
  inferSecondaryRoles,
  inferSeniority,
  nowIso,
  unique,
} from './helpers.js';
import { InMemoryAuthSessionService } from './auth.js';
import { buildSmartDefaultPreferenceProfile } from './preferences.js';

function createCvProfile(userId: string, cv: CV, clock: () => Date): CVProfile {
  const text = `${cv.fileName} ${cv.rawText ?? ''}`;
  const primaryRole = inferPrimaryRole(text);
  const seniority = inferSeniority(text);
  const coreStack = inferCoreStack(text);
  const careerTrack = inferCareerTrack(text);
  return {
    id: createId('cvp'),
    userId,
    cvId: cv.id,
    cvName: cv.fileName,
    primaryRole,
    secondaryRoles: inferSecondaryRoles(text, primaryRole),
    seniority,
    careerTrack,
    coreStack,
    positioningSummary: buildPositioningSummary(primaryRole, coreStack, seniority),
    excludedDomains: inferExcludedDomains(text),
    inferredValues: { primaryRole, seniority, careerTrack, coreStack },
    confirmedValues: {},
    overrideValues: {},
    createdAt: nowIso(clock),
    updatedAt: nowIso(clock),
  };
}

export function bootstrapWorkspace(
  input: SetupBootstrapRequest,
  clock: () => Date = () => new Date(),
  authService: InMemoryAuthSessionService = new InMemoryAuthSessionService(clock),
): SetupBootstrapResponse {
  if (input.uploads.length === 0) {
    throw new Error('At least one CV upload is required.');
  }

  const detectedEmails = unique(input.uploads.flatMap((upload) => extractEmails(`${upload.fileName} ${upload.rawText}`)));
  const initializedUser = authService.initializeUserFromCv({ detectedEmails });
  const user: User = initializedUser.user;

  const cvs: CV[] = input.uploads.map((upload) => ({
    id: createId('cv'),
    userId: user.id,
    fileName: upload.fileName,
    originalFileName: upload.fileName,
    rawText: upload.rawText,
    extractedEmail: extractEmails(`${upload.fileName} ${upload.rawText}`)[0] ?? null,
    processingStatus: 'profile_generated',
    contentHash: null,
    latestVersionId: null,
    latestClassification: null,
    uploadedAt: nowIso(clock),
    updatedAt: nowIso(clock),
  }));

  const cvProfiles = cvs.map((cv) => createCvProfile(user.id, cv, clock));
  const preferenceProfile: PreferenceProfile = buildSmartDefaultPreferenceProfile({
    userId: user.id,
    cvProfiles,
    clock,
  });
  user.defaultCvId = cvs[0]?.id ?? null;
  user.updatedAt = nowIso(clock);

  const setupWarnings: string[] = [...initializedUser.warnings];
  if (cvProfiles.some((profile) => profile.primaryRole === null)) {
    setupWarnings.push('One or more CVs did not yield a strong primary role inference.');
  }
  const magicLinkToken = user.email
    ? authService.sendMagicLink({ userId: user.id, email: user.email }).token
    : null;

  return {
    user,
    cvs,
    cvProfiles,
    preferenceProfile,
    magicLinkToken,
    minimumUsableDataReady: cvs.length > 0,
    detectedEmails,
    selectedEmailCandidate: initializedUser.selectedEmail,
    emailConflictDetected: initializedUser.emailCandidates.length > 1,
    emailCollectionRequired: !user.email,
    returnAccessRequiresVerification: user.accountStatus !== 'verified',
    setupWarnings,
    uploadResults: [],
    setupAiArtifacts: [],
    preferenceAudits: [],
  };
}
