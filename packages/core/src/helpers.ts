import { randomUUID } from 'node:crypto';
import type { EmploymentType, PreferenceLevel, Seniority, WorkSetup } from '@career-rafiq/contracts';

export const ROLE_TEMPLATES = [
  {
    primaryRole: 'Engineering Manager',
    careerTrack: 'Engineering Management',
    keywords: ['engineering manager', 'engineering leadership', 'people management', 'technical manager', 'manager'],
    secondaryRoles: ['Tech Lead', 'Senior Engineer'],
    excludedDomains: ['help desk', 'manual qa'],
  },
  {
    primaryRole: 'AI Engineer',
    careerTrack: 'AI/ML',
    keywords: ['ai engineer', 'machine learning', 'llm', 'genai', 'generative ai', 'prompt engineering', 'ml engineer'],
    secondaryRoles: ['ML Engineer', 'Data Scientist'],
    excludedDomains: ['wordpress', 'cms'],
  },
  {
    primaryRole: 'Data Engineer',
    careerTrack: 'Data Engineering',
    keywords: ['data engineer', 'etl', 'elt', 'warehouse', 'spark', 'dbt', 'airflow'],
    secondaryRoles: ['Analytics Engineer'],
    excludedDomains: ['frontend', 'ui design'],
  },
  {
    primaryRole: 'Platform Engineer',
    careerTrack: 'Platform / Infrastructure',
    keywords: ['platform engineer', 'platform', 'infrastructure', 'devops', 'kubernetes', 'terraform', 'sre'],
    secondaryRoles: ['DevOps Engineer', 'Site Reliability Engineer'],
    excludedDomains: ['marketing'],
  },
  {
    primaryRole: 'Backend Engineer',
    careerTrack: 'IC Engineering',
    keywords: ['backend engineer', 'backend', 'api', 'microservice', 'microservices', 'fastapi', 'django', 'node', 'java', 'spring', 'c#', '.net', 'go'],
    secondaryRoles: ['Full-Stack Engineer', 'Software Engineer'],
    excludedDomains: ['manual qa', 'help desk'],
  },
  {
    primaryRole: 'Frontend Engineer',
    careerTrack: 'IC Engineering',
    keywords: ['frontend engineer', 'front-end', 'frontend', 'react', 'next.js', 'typescript', 'ui engineer'],
    secondaryRoles: ['Full-Stack Engineer', 'Software Engineer'],
    excludedDomains: ['legacy desktop'],
  },
  {
    primaryRole: 'Full-Stack Engineer',
    careerTrack: 'IC Engineering',
    keywords: ['full stack', 'full-stack', 'web engineer'],
    secondaryRoles: ['Frontend Engineer', 'Backend Engineer'],
    excludedDomains: [],
  },
  {
    primaryRole: 'Solutions Architect',
    careerTrack: 'Architecture',
    keywords: ['solutions architect', 'architect', 'architecture'],
    secondaryRoles: ['Platform Architect'],
    excludedDomains: ['help desk'],
  },
] as const;

export const TECH_KEYWORDS = [
  'typescript',
  'javascript',
  'python',
  'fastapi',
  'node',
  'node.js',
  'react',
  'next.js',
  'postgres',
  'postgresql',
  'aws',
  'azure',
  'gcp',
  'docker',
  'kubernetes',
  'terraform',
  'c#',
  '.net',
  'go',
  'java',
  'spring',
  'llm',
  'ml',
  'machine learning',
  'airflow',
  'dbt',
  'spark',
] as const;

export const SENIORITY_ORDER: Seniority[] = [
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

export const PREF_LEVEL_SCORE: Record<PreferenceLevel, number> = {
  top: 5,
  ok: 3,
  neutral: 0,
  not_recommended: -4,
  hard_skip: 0,
};

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString();
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9.+#/-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function joinNonEmpty(values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)).join(' ');
}

export function includesText(text: string, needle: string): boolean {
  return normalizeText(text).includes(normalizeText(needle));
}

export function countKeywordMatches(text: string, keywords: readonly string[]): string[] {
  const normalized = normalizeText(text);
  return keywords.filter((keyword) => normalized.includes(normalizeText(keyword)));
}

export function extractEmails(text: string): string[] {
  return unique((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((value) => value.toLowerCase()));
}

export function matchRoleTemplate(text: string) {
  const normalized = normalizeText(text);
  for (const template of ROLE_TEMPLATES) {
    if (template.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
      return template;
    }
  }
  return null;
}

export function inferSeniority(text: string): Seniority {
  const normalized = normalizeText(text);
  const patterns: Array<[string, Seniority]> = [
    ['executive', 'executive'],
    ['chief', 'executive'],
    ['director', 'director'],
    ['vice president', 'executive'],
    ['vp', 'executive'],
    ['manager', 'manager'],
    ['lead', 'lead'],
    ['staff', 'staff'],
    ['principal', 'staff'],
    ['senior', 'senior'],
    ['sr', 'senior'],
    ['mid', 'mid'],
    ['intermediate', 'mid'],
    ['junior', 'junior'],
    ['entry level', 'junior'],
    ['intern', 'intern'],
    ['graduate', 'intern'],
  ];
  for (const [pattern, seniority] of patterns) {
    if (normalized.includes(pattern)) return seniority;
  }
  return 'unknown';
}

export function inferPrimaryRole(text: string): string | null {
  return matchRoleTemplate(text)?.primaryRole ?? null;
}

export function inferCareerTrack(text: string): string | null {
  return matchRoleTemplate(text)?.careerTrack ?? null;
}

export function inferSecondaryRoles(text: string, primaryRole: string | null): string[] {
  const template = matchRoleTemplate(text);
  return unique([primaryRole ?? '', ...(template?.secondaryRoles ?? [])]);
}

export function inferCoreStack(text: string): string[] {
  const normalized = normalizeText(text);
  return unique(TECH_KEYWORDS.filter((keyword) => normalized.includes(normalizeText(keyword))));
}

export function inferExcludedDomains(text: string): string[] {
  return unique(matchRoleTemplate(text)?.excludedDomains ?? []);
}

export function buildPositioningSummary(primaryRole: string | null, coreStack: string[], seniority: Seniority): string {
  const role = primaryRole ?? 'General Software Engineer';
  const level = seniority === 'unknown' ? 'unspecified level' : `${seniority} level`;
  const stack = coreStack.length > 0 ? coreStack.slice(0, 3).join(', ') : 'broad delivery';
  return `${level} ${role} with emphasis on ${stack}.`;
}
