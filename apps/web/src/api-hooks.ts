import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListDiagnosticEventsRequest,
  PreferenceProfile,
  RecordClientDiagnosticEventRequest,
  ResolveTrackerDuplicateRequest,
  TrackerStatus,
  UpdateCvProfileRequest,
  UpdateJobReviewRequest,
  UpdateTrackerRecommendationRequest,
  UpdateTrackerVerdictRequest,
} from '@career-rafiq/contracts';
import { webApiClient } from './api-client.js';

export const webQueryKeys = {
  session: ['auth', 'session'] as const,
  setupCurrent: ['setup', 'current'] as const,
  cvsList: ['cvs', 'list'] as const,
  cvDetail: (cvId: string) => ['cvs', cvId, 'detail'] as const,
  opsSummary: ['ops', 'summary'] as const,
  runtimeDetail: ['ops', 'runtime-detail'] as const,
  eyeCurrent: ['ops', 'eye', 'current'] as const,
  eyeSessions: ['ops', 'eye', 'sessions'] as const,
  diagnosticEvents: (filters: ListDiagnosticEventsRequest) => ['ops', 'eye', 'events', filters] as const,
  runtimeReadiness: ['runtime', 'readiness'] as const,
  jobReview: (jobId: string) => ['jobs', jobId, 'review'] as const,
  trackerList: ['tracker', 'list'] as const,
  trackerDetail: (jobId: string) => ['tracker', jobId, 'detail'] as const,
} as const;

export function useSessionQuery() {
  return useQuery({
    queryKey: webQueryKeys.session,
    queryFn: () => webApiClient.getSession(),
    staleTime: 30_000,
  });
}

export function useCurrentSetupQuery() {
  return useQuery({
    queryKey: webQueryKeys.setupCurrent,
    queryFn: () => webApiClient.getCurrentSetup(),
  });
}

export function useBootstrapMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: readonly File[]) => webApiClient.bootstrapFromFiles(files),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.session }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvsList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useUploadAdditionalCvsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: readonly File[]) => webApiClient.uploadAdditionalCvs(files),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.session }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvsList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useCvListQuery() {
  return useQuery({
    queryKey: webQueryKeys.cvsList,
    queryFn: () => webApiClient.listCvs(),
  });
}

export function useCvDetailQuery(cvId: string) {
  return useQuery({
    queryKey: webQueryKeys.cvDetail(cvId),
    queryFn: () => webApiClient.getCvDetail(cvId),
    enabled: cvId.length > 0,
  });
}

export function useAnalyzeCvUploadsMutation() {
  return useMutation({
    mutationFn: (files: readonly File[]) => webApiClient.analyzeCvUploads(files),
  });
}

export function useCommitCvUploadsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files, decisions }: { files: readonly File[]; decisions: readonly import('@career-rafiq/contracts').CvUploadCommitDecision[] }) =>
      webApiClient.commitCvUploads(files, decisions),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.session }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvsList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useSetDefaultCvMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cvId, reevaluateTrackedJobs = true }: { cvId: string; reevaluateTrackedJobs?: boolean }) =>
      webApiClient.setDefaultCv(cvId, reevaluateTrackedJobs),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.session }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvsList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useSetCvDefaultMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cvId: string) => webApiClient.setCvDefault(cvId),
    onSuccess: (_, cvId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.session }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvsList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvDetail(cvId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useRefreshSetupSuggestionsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reevaluateTrackedJobs = true }: { reevaluateTrackedJobs?: boolean }) =>
      webApiClient.refreshSetupSuggestions(reevaluateTrackedJobs),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useUpdateCvProfileMutation(cvId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateCvProfileRequest) => webApiClient.updateCvProfile(cvId, patch),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvsList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.cvDetail(cvId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useUpdatePreferencesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      preferenceProfile,
      reevaluateTrackedJobs = true,
    }: {
      preferenceProfile: PreferenceProfile;
      reevaluateTrackedJobs?: boolean;
    }) => webApiClient.updatePreferences(preferenceProfile, reevaluateTrackedJobs),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useMagicLinkRequestMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => webApiClient.requestMagicLink(email),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.session }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useMagicLinkConsumeQuery(token: string | null, email: string | null) {
  return useQuery({
    queryKey: ['auth', 'consume', token, email] as const,
    queryFn: () => webApiClient.consumeMagicLink(token ?? '', email),
    enabled: Boolean(token),
  });
}

export function useJobReviewQuery(jobId: string) {
  return useQuery({
    queryKey: webQueryKeys.jobReview(jobId),
    queryFn: () => webApiClient.getJobReview(jobId),
    enabled: jobId.length > 0,
  });
}

export function useOpsSummaryQuery() {
  return useQuery({
    queryKey: webQueryKeys.opsSummary,
    queryFn: () => webApiClient.getOpsSummary(),
  });
}

export function useRuntimeReadinessQuery() {
  return useQuery({
    queryKey: webQueryKeys.runtimeReadiness,
    queryFn: () => webApiClient.getRuntimeReadiness(),
  });
}

export function useRuntimeDetailQuery() {
  return useQuery({
    queryKey: webQueryKeys.runtimeDetail,
    queryFn: () => webApiClient.getRuntimeDetail(),
  });
}

export function useEyeCurrentQuery() {
  return useQuery({
    queryKey: webQueryKeys.eyeCurrent,
    queryFn: () => webApiClient.getCurrentEyeSession(),
  });
}

export function useEyeSessionsQuery() {
  return useQuery({
    queryKey: webQueryKeys.eyeSessions,
    queryFn: () => webApiClient.listEyeSessions(),
  });
}

export function useDiagnosticEventsQuery(filters: ListDiagnosticEventsRequest, enabled = true) {
  return useQuery({
    queryKey: webQueryKeys.diagnosticEvents(filters),
    queryFn: () => webApiClient.listDiagnosticEvents(filters),
    enabled,
  });
}

export function useStartEyeSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: webApiClient.startEyeSession.bind(webApiClient),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.eyeCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.eyeSessions }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.runtimeDetail }),
      ]),
  });
}

export function useStopEyeSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => webApiClient.stopEyeSession(sessionId),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.eyeCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.eyeSessions }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.runtimeDetail }),
      ]),
  });
}

export function useRecordClientDiagnosticEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RecordClientDiagnosticEventRequest) => webApiClient.recordClientDiagnosticEvent(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ops', 'eye'] }),
  });
}

export function useManualCaptureMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: webApiClient.captureManual.bind(webApiClient),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useDevEmailOutboxLookupMutation() {
  return useMutation({
    mutationFn: (email: string) => webApiClient.getLatestDevEmailOutbox(email),
  });
}

export function useSaveJobReviewMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateJobReviewRequest) => webApiClient.saveJobReview(jobId, patch),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.jobReview(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useReprocessJobMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reevaluateAfterReprocess: boolean) => webApiClient.reprocessJob(jobId, reevaluateAfterReprocess),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.jobReview(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useEvaluateJobMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => webApiClient.evaluateJob(jobId),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.jobReview(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useTrackerListQuery() {
  return useQuery({
    queryKey: webQueryKeys.trackerList,
    queryFn: () => webApiClient.getTrackerList(),
  });
}

export function useTrackerDetailQuery(jobId: string) {
  return useQuery({
    queryKey: webQueryKeys.trackerDetail(jobId),
    queryFn: () => webApiClient.getTrackerDetail(jobId),
    enabled: jobId.length > 0,
  });
}

export function useUpdateTrackerStatusMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: TrackerStatus) => webApiClient.updateTrackerStatus(jobId, status),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useAddTrackerNoteMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => webApiClient.addTrackerNote(jobId, note),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useUpdateTrackerRecommendationMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTrackerRecommendationRequest) => webApiClient.updateTrackerRecommendation(jobId, payload),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.jobReview(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useUpdateTrackerVerdictMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTrackerVerdictRequest) => webApiClient.updateTrackerVerdict(jobId, payload),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.jobReview(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useResolveTrackerDuplicateMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ResolveTrackerDuplicateRequest) => webApiClient.resolveTrackerDuplicate(jobId, payload),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerDetail(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.jobReview(jobId) }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => webApiClient.logout(),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: webQueryKeys.session }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.setupCurrent }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.trackerList }),
        queryClient.invalidateQueries({ queryKey: webQueryKeys.opsSummary }),
      ]),
  });
}
