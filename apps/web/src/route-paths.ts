export const webRoutes = {
  setup: '/setup',
  login: '/login',
  review: '/review',
  cvs: '/cvs',
  ops: '/ops',
  opsEye: '/ops/eye',
  manualCapture: '/capture/manual',
  jobReview: '/jobs/:jobId/review',
  tracker: '/tracker',
  trackerDetail: '/tracker/:jobId',
  authConsume: '/auth/consume',
} as const;

export function trackerDetailPath(jobId: string): string {
  return `/tracker/${encodeURIComponent(jobId)}`;
}

export function jobReviewPath(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}/review`;
}

export function opsEyePath(filters: {
  eyeSessionId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  area?: string | null;
  severity?: string | null;
} = {}): string {
  const params = new URLSearchParams();
  if (filters.eyeSessionId) params.set('eyeSessionId', filters.eyeSessionId);
  if (filters.requestId) params.set('requestId', filters.requestId);
  if (filters.jobId) params.set('jobId', filters.jobId);
  if (filters.area) params.set('area', filters.area);
  if (filters.severity) params.set('severity', filters.severity);
  const suffix = params.toString();
  return suffix ? `/ops/eye?${suffix}` : '/ops/eye';
}
