import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SESSION_COOKIE_NAME = 'career_rafiq_session';
const REPO_ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));

export function getApiDataDir(): string {
  return process.env['CAREERRAFIQ_DATA_DIR']
    ? resolve(REPO_ROOT_DIR, process.env['CAREERRAFIQ_DATA_DIR'])
    : resolve(REPO_ROOT_DIR, 'apps', 'api', 'data');
}

export function getUploadsDir(): string {
  return process.env['CAREERRAFIQ_UPLOADS_DIR']
    ? resolve(process.env['CAREERRAFIQ_UPLOADS_DIR'])
    : resolve(getApiDataDir(), 'uploads');
}

export function getMaxCvUploadCount(): number {
  const parsed = Number(process.env['CAREERRAFIQ_MAX_CV_UPLOAD_COUNT'] ?? '5');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}

export function getMaxCvUploadBytes(): number {
  const parsed = Number(process.env['CAREERRAFIQ_MAX_CV_UPLOAD_BYTES'] ?? `${8 * 1024 * 1024}`);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 8 * 1024 * 1024;
}

export function getServedWebDistDir(): string {
  return process.env['CAREERRAFIQ_WEB_DIST_DIR']
    ? resolve(REPO_ROOT_DIR, process.env['CAREERRAFIQ_WEB_DIST_DIR'])
    : resolve(REPO_ROOT_DIR, 'apps', 'web', 'dist');
}

export function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

export function isDevOutboxEnabled(): boolean {
  return process.env['CAREERRAFIQ_ENABLE_DEV_OUTBOX'] === '1';
}

export function allowInsecureDevCookie(): boolean {
  return process.env['CAREERRAFIQ_INSECURE_DEV_COOKIE'] === '1';
}

export function shouldUseSecureCookies(): boolean {
  return isProduction() || !allowInsecureDevCookie();
}

export function getCookieSameSiteMode(): 'none' | 'lax' {
  return shouldUseSecureCookies() ? 'none' : 'lax';
}

export function getAllowedCorsOrigins(): string[] {
  const values = [
    process.env['CAREERRAFIQ_WEB_ORIGIN'],
    process.env['CAREERRAFIQ_EXTENSION_ORIGIN'],
    process.env['CAREERRAFIQ_ALLOWED_ORIGINS'],
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

export function getWebOrigin(): string | null {
  return process.env['CAREERRAFIQ_WEB_ORIGIN']?.trim() || null;
}

export function getExtensionOrigin(): string | null {
  return process.env['CAREERRAFIQ_EXTENSION_ORIGIN']?.trim() || null;
}

export function getEmailFromAddress(): string {
  return process.env['CAREERRAFIQ_EMAIL_FROM']?.trim() || 'no-reply@careerrafiq.local';
}

export function getEmailProviderMode(): 'smtp' | 'dev_outbox' | 'disabled' {
  if (getSmtpHost()) {
    return 'smtp';
  }
  return isDevOutboxEnabled() ? 'dev_outbox' : 'disabled';
}

export function getSmtpHost(): string | null {
  return process.env['CAREERRAFIQ_SMTP_HOST']?.trim() || null;
}

export function getSmtpPort(): number {
  const parsed = Number(process.env['CAREERRAFIQ_SMTP_PORT'] ?? '587');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 587;
}

export function getSmtpSecure(): boolean {
  return process.env['CAREERRAFIQ_SMTP_SECURE'] === '1';
}

export function getSmtpUser(): string | null {
  return process.env['CAREERRAFIQ_SMTP_USER']?.trim() || null;
}

export function getSmtpPassword(): string | null {
  return process.env['CAREERRAFIQ_SMTP_PASSWORD']?.trim() || null;
}

export function getMagicLinkThrottleMs(): number {
  const parsed = Number(process.env['CAREERRAFIQ_MAGIC_LINK_THROTTLE_SECONDS'] ?? '60');
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed * 1000) : 60_000;
}

export function isEyeModeEnabled(): boolean {
  return !isProduction() && process.env['CAREERRAFIQ_ENABLE_EYE_MODE'] === '1';
}

export function getOperatorEmails(): string[] {
  return (process.env['CAREERRAFIQ_OPERATOR_EMAILS'] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isOperatorEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return getOperatorEmails().includes(email.trim().toLowerCase());
}

export function getEyeRetentionDays(): number {
  const parsed = Number(process.env['CAREERRAFIQ_EYE_RETENTION_DAYS'] ?? '7');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 7;
}

export function isDevAutoVerifyMagicLinkEnabled(): boolean {
  return !isProduction() && process.env['CAREERRAFIQ_DEV_AUTO_VERIFY_MAGIC_LINK'] === '1';
}

export function getUploadRateLimitMax(): number {
  const parsed = Number(process.env['CAREERRAFIQ_UPLOAD_RATE_LIMIT_MAX'] ?? '6');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6;
}

export function getUploadRateLimitWindowMs(): number {
  const parsed = Number(process.env['CAREERRAFIQ_UPLOAD_RATE_LIMIT_WINDOW_SECONDS'] ?? '300');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed * 1000) : 300_000;
}

export function getCaptureRateLimitMax(): number {
  const parsed = Number(process.env['CAREERRAFIQ_CAPTURE_RATE_LIMIT_MAX'] ?? '30');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
}

export function getCaptureRateLimitWindowMs(): number {
  const parsed = Number(process.env['CAREERRAFIQ_CAPTURE_RATE_LIMIT_WINDOW_SECONDS'] ?? '60');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed * 1000) : 60_000;
}

export interface AiFeatureFlags {
  aiSetupSuggestions: boolean;
  aiExtractionFallback: boolean;
  aiSignalInference: boolean;
  aiConsensus: boolean;
}

export function getAiFeatureFlags(): AiFeatureFlags {
  return {
    aiSetupSuggestions: process.env['CAREERRAFIQ_ENABLE_AI_SETUP_SUGGESTIONS'] === '1',
    aiExtractionFallback: process.env['CAREERRAFIQ_ENABLE_AI_EXTRACTION_FALLBACK'] === '1',
    aiSignalInference: process.env['CAREERRAFIQ_ENABLE_AI_SIGNAL_INFERENCE'] === '1',
    aiConsensus: process.env['CAREERRAFIQ_ENABLE_AI_CONSENSUS'] === '1',
  };
}

export function getOpenAiApiKey(): string | null {
  return process.env['OPENAI_API_KEY']?.trim() || null;
}

export function getOpenAiBaseUrl(): string {
  return process.env['CAREERRAFIQ_OPENAI_BASE_URL']?.trim() || 'https://api.openai.com/v1';
}

export function getOpenAiModel(): string {
  return process.env['CAREERRAFIQ_OPENAI_MODEL']?.trim() || 'gpt-5-mini';
}

export function getOpenAiTimeoutMs(): number {
  const parsed = Number(process.env['CAREERRAFIQ_OPENAI_TIMEOUT_MS'] ?? '45000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 45000;
}
