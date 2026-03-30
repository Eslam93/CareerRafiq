import type { CVProfile, EvaluationInput, Job, PreferenceProfile, Verdict } from '@career-rafiq/contracts';

export * from './harness.js';

const timestamp = '2026-01-01T00:00:00.000Z';

const backendCvProfile: CVProfile = {
  id: 'cvp_backend_1',
  userId: 'usr_demo',
  cvId: 'cv_backend_1',
  cvName: 'Backend CV',
  primaryRole: 'Backend Engineer',
  secondaryRoles: ['Full-Stack Engineer'],
  seniority: 'senior',
  careerTrack: 'IC Engineering',
  coreStack: ['Python', 'FastAPI', 'PostgreSQL', 'AWS'],
  positioningSummary: 'Senior backend engineer focused on APIs and cloud delivery.',
  excludedDomains: ['help desk'],
  inferredValues: {},
  confirmedValues: {},
  overrideValues: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const fullStackCvProfile: CVProfile = {
  id: 'cvp_fullstack_1',
  userId: 'usr_demo',
  cvId: 'cv_fullstack_1',
  cvName: 'Full-Stack CV',
  primaryRole: 'Full-Stack Engineer',
  secondaryRoles: ['Frontend Engineer', 'Backend Engineer'],
  seniority: 'mid',
  careerTrack: 'IC Engineering',
  coreStack: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
  positioningSummary: 'Product-minded engineer balancing frontend delivery and API integration.',
  excludedDomains: ['call center'],
  inferredValues: {},
  confirmedValues: {},
  overrideValues: {},
  createdAt: timestamp,
  updatedAt: timestamp,
};

const dataPlatformCvProfile: CVProfile = {
  id: 'cvp_data_1',
  userId: 'usr_demo',
  cvId: 'cv_data_1',
  cvName: 'Data Platform CV',
  primaryRole: 'Data Platform Engineer',
  secondaryRoles: ['Platform Engineer'],
  seniority: 'senior',
  careerTrack: 'IC Engineering',
  coreStack: ['Python', 'Airflow', 'dbt', 'Snowflake'],
  positioningSummary: 'Senior engineer focused on data pipelines and platform reliability.',
  excludedDomains: ['customer support'],
  inferredValues: {},
  confirmedValues: {},
  overrideValues: {},
  createdAt: timestamp,
  updatedAt: timestamp,
};

const backendPreferenceProfile: PreferenceProfile = {
  id: 'pref_demo_backend',
  userId: 'usr_demo',
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
  preferredLocations: ['Remote'],
  avoidedLocations: [],
  preferredRoleTracks: ['IC Engineering'],
  avoidedRoleTracks: [],
  preferredJobTitles: ['Backend Engineer', 'Platform Engineer', 'Full-Stack Engineer'],
  avoidedJobTitles: ['Customer Support Engineer'],
  preferredSectors: [],
  avoidedSectors: [],
  preferredCompanyTypes: [],
  avoidedCompanyTypes: [],
  preferredKeywords: ['Python', 'FastAPI', 'AWS'],
  requiredKeywords: [],
  avoidedKeywords: ['help desk', 'call center'],
  inferredValues: {},
  confirmedValues: {},
  overrideValues: {},
  createdAt: timestamp,
  updatedAt: timestamp,
};

const productPreferenceProfile: PreferenceProfile = {
  ...backendPreferenceProfile,
  id: 'pref_demo_product',
  preferredLocations: ['New York, NY'],
  preferredJobTitles: ['Full-Stack Engineer', 'Frontend Engineer'],
  preferredKeywords: ['TypeScript', 'React', 'Node.js'],
  avoidedKeywords: ['help desk', 'call center', 'customer support'],
  createdAt: timestamp,
  updatedAt: timestamp,
};

const dataPlatformPreferenceProfile: PreferenceProfile = {
  ...backendPreferenceProfile,
  id: 'pref_demo_data',
  preferredJobTitles: ['Data Platform Engineer', 'Platform Engineer'],
  preferredKeywords: ['Python', 'Airflow', 'dbt'],
  avoidedKeywords: ['customer support'],
  createdAt: timestamp,
  updatedAt: timestamp,
};

function createNormalizedJob(
  overrides: Partial<Job['normalizedJobObject']>,
): Job['normalizedJobObject'] {
  return {
    title: 'Demo Job',
    company: 'Example Co',
    location: 'Remote',
    workSetup: 'remote',
    employmentType: 'full_time',
    description: 'Demo description.',
    recruiterOrPosterSignal: null,
    companySector: 'Software',
    companyType: 'Startup',
    keywords: ['demo'],
    scopeSignals: [],
    greenfieldSignal: null,
    highOwnershipSignal: null,
    ...overrides,
  };
}

function createJob(overrides: Partial<Job>): Job {
  return {
    id: 'job_demo',
    userId: 'usr_demo',
    sourceIdentifier: 'greenhouse',
    sourceUrl: 'https://example.com/jobs/demo',
    rawCaptureContent: 'Demo job capture',
    normalizedJobObject: createNormalizedJob({}),
    extractionConfidence: 0.9,
    captureSourceType: 'greenhouse',
    extractionVersion: 'extraction-v1',
    jobExtractionState: 'ready_for_evaluation',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createCase(
  id: string,
  summary: string,
  input: EvaluationInput,
  expectedVerdict: Verdict | null,
  expectedRecommendedCvId: string | null,
  expectedReviewGateStatus: EvaluationInput['reviewGateStatus'],
): BenchmarkCase {
  return {
    id,
    summary,
    input,
    expectedVerdict,
    expectedRecommendedCvId,
    expectedReviewGateStatus,
  };
}

export interface BenchmarkCase {
  id: string;
  summary: string;
  input: EvaluationInput;
  expectedVerdict: Verdict | null;
  expectedRecommendedCvId: string | null;
  expectedReviewGateStatus: EvaluationInput['reviewGateStatus'];
}

const greenhouseBackendJob = createJob({
  id: 'job_backend_1',
  userId: 'usr_demo',
  sourceIdentifier: 'greenhouse',
  sourceUrl: 'https://example.com/jobs/backend-engineer',
  rawCaptureContent: 'Backend Engineer at Example Co',
  normalizedJobObject: createNormalizedJob({
    title: 'Backend Engineer',
    company: 'Example Co',
    location: 'Remote',
    workSetup: 'remote',
    employmentType: 'full_time',
    description: 'Build APIs with Python, FastAPI, PostgreSQL, and AWS.',
    recruiterOrPosterSignal: null,
    companySector: 'Software',
    companyType: 'Startup',
    keywords: ['Python', 'FastAPI', 'AWS', 'PostgreSQL'],
  }),
  extractionConfidence: 0.96,
  captureSourceType: 'greenhouse',
  extractionVersion: 'extraction-v1',
  jobExtractionState: 'ready_for_evaluation',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const leverFullStackJob = createJob({
  id: 'job_lever_1',
  sourceIdentifier: 'lever',
  sourceUrl: 'https://jobs.example.com/full-stack-engineer',
  normalizedJobObject: createNormalizedJob({
    title: 'Senior Full-Stack Engineer',
    company: 'SaaSForge',
    location: 'New York, NY',
    workSetup: 'hybrid',
    employmentType: 'full_time',
    description: 'Build customer-facing product surfaces with React, TypeScript, and Node.js.',
    recruiterOrPosterSignal: 'Hiring team',
    companySector: 'SaaS',
    companyType: 'Scale-up',
    keywords: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
    highOwnershipSignal: true,
  }),
});

const linkedinSupportJob = createJob({
  id: 'job_linkedin_1',
  sourceIdentifier: 'linkedin',
  sourceUrl: 'https://www.linkedin.com/jobs/view/customer-support-engineer',
  rawCaptureContent: 'LinkedIn job page with nearby content and a noisy sidebar.',
  normalizedJobObject: createNormalizedJob({
    title: 'Customer Support Engineer',
    company: 'HelpNow',
    location: 'Austin, TX',
    workSetup: 'onsite',
    employmentType: 'full_time',
    description: 'Investigate tickets, handle escalations, and support customer troubleshooting.',
    recruiterOrPosterSignal: 'Recruiter post',
    companySector: 'Customer Support',
    companyType: 'SMB',
    keywords: ['Zendesk', 'Customer Support', 'Escalations'],
  }),
  extractionConfidence: 0.78,
});

const indeedOpsJob = createJob({
  id: 'job_indeed_1',
  sourceIdentifier: 'indeed',
  sourceUrl: 'https://www.indeed.com/viewjob?jk=platform-support',
  rawCaptureContent: 'Indeed page with banner content and a short role snippet.',
  normalizedJobObject: createNormalizedJob({
    title: 'Platform Support Associate',
    company: 'Northwind',
    location: 'Chicago, IL',
    workSetup: 'onsite',
    employmentType: 'full_time',
    description: 'Respond to internal support queues and triage operational requests.',
    recruiterOrPosterSignal: null,
    companySector: 'Operations',
    companyType: 'Enterprise',
    keywords: ['Support', 'Operations', 'Triage'],
  }),
  extractionConfidence: 0.74,
});

const workdayPlatformJob = createJob({
  id: 'job_workday_1',
  sourceIdentifier: 'workday',
  sourceUrl: 'https://example.workdayjobs.com/en-US/ExampleCareers/job/Platform-Engineer',
  rawCaptureContent: 'Workday job payload with minimal visible context.',
  normalizedJobObject: createNormalizedJob({
    title: 'Platform Engineer',
    company: 'Contoso',
    location: 'Remote',
    workSetup: 'remote',
    employmentType: 'full_time',
    description: 'Support internal platform services, infrastructure, and delivery pipelines.',
    recruiterOrPosterSignal: null,
    companySector: 'Infrastructure',
    companyType: 'Enterprise',
    keywords: ['Platform', 'Infrastructure', 'Python'],
    scopeSignals: ['platform_scope'],
  }),
  extractionConfidence: 0.52,
  jobExtractionState: 'review_required',
});

const glassdoorDataJob = createJob({
  id: 'job_glassdoor_1',
  sourceIdentifier: 'glassdoor',
  sourceUrl: 'https://www.glassdoor.com/job-listing/data-platform-engineer',
  rawCaptureContent: 'Glassdoor posting with nearby company reviews and job snippets.',
  normalizedJobObject: createNormalizedJob({
    title: 'Data Platform Engineer',
    company: 'DataWave',
    location: 'Remote',
    workSetup: 'remote',
    employmentType: 'full_time',
    description: 'Build ETL pipelines, manage data contracts, and improve reliability.',
    recruiterOrPosterSignal: 'Posted by hiring team',
    companySector: 'Data Infrastructure',
    companyType: 'Mid-market',
    keywords: ['Python', 'Airflow', 'dbt', 'Snowflake'],
  }),
  extractionConfidence: 0.9,
});

export const benchmarkCases: BenchmarkCase[] = [
  createCase(
    'greenhouse_backend_apply',
    'Clean Greenhouse backend role with strong stack alignment.',
    {
      job: greenhouseBackendJob,
      cvProfiles: [backendCvProfile, fullStackCvProfile],
      preferenceProfile: backendPreferenceProfile,
      reviewGateStatus: 'proceed',
    },
    'apply',
    backendCvProfile.cvId,
    'proceed',
  ),
  createCase(
    'lever_fullstack_consider',
    'Lever full-stack role with enough overlap for a consider verdict.',
    {
      job: leverFullStackJob,
      cvProfiles: [fullStackCvProfile, backendCvProfile],
      preferenceProfile: productPreferenceProfile,
      reviewGateStatus: 'proceed',
    },
    'consider',
    fullStackCvProfile.cvId,
    'proceed',
  ),
  createCase(
    'linkedin_support_skip',
    'Noisy LinkedIn support role with weak fit for the available CVs.',
    {
      job: linkedinSupportJob,
      cvProfiles: [backendCvProfile, fullStackCvProfile],
      preferenceProfile: backendPreferenceProfile,
      reviewGateStatus: 'proceed',
    },
    'skip',
    backendCvProfile.cvId,
    'proceed',
  ),
  createCase(
    'indeed_ops_skip',
    'Indeed ops role that should remain a skip instead of hard failing.',
    {
      job: indeedOpsJob,
      cvProfiles: [backendCvProfile, fullStackCvProfile],
      preferenceProfile: backendPreferenceProfile,
      reviewGateStatus: 'proceed',
    },
    'skip',
    backendCvProfile.cvId,
    'proceed',
  ),
  createCase(
    'workday_platform_review_required',
    'Workday platform role with low-confidence input that stays in review.',
    {
      job: workdayPlatformJob,
      cvProfiles: [dataPlatformCvProfile, backendCvProfile],
      preferenceProfile: dataPlatformPreferenceProfile,
      reviewGateStatus: 'review_required',
    },
    null,
    null,
    'review_required',
  ),
  createCase(
    'glassdoor_data_consider',
    'Glassdoor data platform role that is a plausible second-choice match.',
    {
      job: glassdoorDataJob,
      cvProfiles: [dataPlatformCvProfile, backendCvProfile],
      preferenceProfile: dataPlatformPreferenceProfile,
      reviewGateStatus: 'proceed',
    },
    'consider',
    dataPlatformCvProfile.cvId,
    'proceed',
  ),
];
