import type {
  MagicLinkSendRequest,
  MagicLinkSendResponse,
  MagicLinkVerifyRequest,
  MagicLinkVerifyResponse,
  User,
} from '@career-rafiq/contracts';
import { createId, nowIso, unique } from './helpers.js';

export type AccessLevel = 'temporary' | 'verified';

export interface InitializeUserFromCvInput {
  detectedEmails: string[];
  preferredEmail?: string;
  temporarySessionHours?: number;
}

export interface InitializeUserFromCvResult {
  user: User;
  selectedEmail: string | null;
  emailCandidates: string[];
  warnings: string[];
}

export interface AuthCanRunEvaluationInput {
  evaluationsToday?: number;
  dailyLimit?: number;
  at?: Date;
}

export interface StoredMagicLink {
  token: string;
  userId: string;
  email: string;
  expiresAt: string;
}

export interface AuthSessionState {
  users: User[];
  magicLinks: StoredMagicLink[];
  evaluationsByUserAndDay: Array<{
    key: string;
    count: number;
  }>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function pickEmail(candidates: string[], preferredEmail?: string): string | null {
  const deduped = unique(candidates.map(normalizeEmail));
  if (deduped.length === 0) return null;
  if (!preferredEmail) return deduped[0] ?? null;
  const normalizedPreferred = normalizeEmail(preferredEmail);
  return deduped.find((email) => email === normalizedPreferred) ?? deduped[0] ?? null;
}

function dateKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export class InMemoryAuthSessionService {
  private readonly users = new Map<string, User>();

  private readonly magicLinks = new Map<string, StoredMagicLink>();

  private readonly evaluationsByUserAndDay = new Map<string, number>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  initializeUserFromCv(input: InitializeUserFromCvInput): InitializeUserFromCvResult {
    const emailCandidates = unique(input.detectedEmails.map(normalizeEmail));
    const selectedEmail = pickEmail(emailCandidates, input.preferredEmail);
    const warnings: string[] = [];

    if (emailCandidates.length > 1) {
      warnings.push('Multiple email candidates detected; first valid candidate selected unless preferred email matched.');
    }
    if (!selectedEmail) {
      warnings.push('No email detected; created temporary session user.');
    }

    const now = this.clock();
    const temporaryHours = input.temporarySessionHours ?? 24;
    const user: User = {
      id: createId('usr'),
      email: selectedEmail,
      defaultCvId: null,
      accountStatus: selectedEmail ? 'unverified' : 'temporary',
      emailVerificationStatus: selectedEmail ? 'pending' : 'unverified',
      authMethod: 'magic_link',
      createdAt: nowIso(() => now),
      updatedAt: nowIso(() => now),
      lastVerifiedLoginAt: null,
      temporarySessionExpiresAt: new Date(now.getTime() + temporaryHours * 60 * 60 * 1000).toISOString(),
    };

    this.users.set(user.id, user);
    return { user, selectedEmail, emailCandidates, warnings };
  }

  sendMagicLink(request: MagicLinkSendRequest, expiresInMinutes = 30): MagicLinkSendResponse & { expiresAt: string } {
    const user = this.getUserOrThrow(request.userId);
    const sentTo = normalizeEmail(request.email);
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000).toISOString();
    const token = createId('ml');

    user.email = sentTo;
    user.accountStatus = user.accountStatus === 'verified' ? 'verified' : 'unverified';
    user.emailVerificationStatus = user.accountStatus === 'verified' ? 'verified' : 'pending';
    user.temporarySessionExpiresAt = user.accountStatus === 'verified'
      ? null
      : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    user.updatedAt = nowIso(() => now);

    this.magicLinks.set(token, {
      token,
      userId: user.id,
      email: sentTo,
      expiresAt,
    });

    return {
      token,
      sentTo,
      expiresAt,
    };
  }

  verifyMagicLink(request: MagicLinkVerifyRequest): MagicLinkVerifyResponse {
    const record = this.magicLinks.get(request.token.trim());
    if (!record) {
      return {
        verified: false,
        userId: null,
        accessLevel: 'temporary',
      };
    }

    const email = normalizeEmail(request.email);
    if (record.email !== email) {
      return {
        verified: false,
        userId: null,
        accessLevel: 'temporary',
      };
    }

    const now = this.clock();
    if (new Date(record.expiresAt).getTime() < now.getTime()) {
      this.magicLinks.delete(record.token);
      return {
        verified: false,
        userId: null,
        accessLevel: 'temporary',
      };
    }

    const user = this.getUserOrThrow(record.userId);
    user.email = email;
    user.accountStatus = 'verified';
    user.emailVerificationStatus = 'verified';
    user.lastVerifiedLoginAt = nowIso(() => now);
    user.temporarySessionExpiresAt = null;
    user.updatedAt = nowIso(() => now);
    this.magicLinks.delete(record.token);

    return {
      verified: true,
      userId: user.id,
      accessLevel: 'verified',
    };
  }

  getAccessLevel(user: User): AccessLevel {
    return getAccessLevel(user);
  }

  canRunEvaluation(user: User, input: AuthCanRunEvaluationInput = {}): boolean {
    return canRunEvaluation(user, {
      evaluationsToday:
        input.evaluationsToday ??
        this.evaluationsByUserAndDay.get(`${user.id}:${dateKey(input.at ?? this.clock())}`) ??
        0,
      dailyLimit: input.dailyLimit ?? Number.POSITIVE_INFINITY,
    });
  }

  noteEvaluationCompleted(userId: string, at: Date = this.clock()): void {
    const key = `${userId}:${dateKey(at)}`;
    const current = this.evaluationsByUserAndDay.get(key) ?? 0;
    this.evaluationsByUserAndDay.set(key, current + 1);
  }

  getUser(userId: string): User | null {
    return this.users.get(userId) ?? null;
  }

  exportState(): AuthSessionState {
    return {
      users: [...this.users.values()].map((user) => ({ ...user })),
      magicLinks: [...this.magicLinks.values()].map((record) => ({ ...record })),
      evaluationsByUserAndDay: [...this.evaluationsByUserAndDay.entries()].map(([key, count]) => ({ key, count })),
    };
  }

  importState(state: AuthSessionState): void {
    this.users.clear();
    this.magicLinks.clear();
    this.evaluationsByUserAndDay.clear();
    for (const user of state.users) {
      this.users.set(user.id, { ...user });
    }
    for (const record of state.magicLinks) {
      this.magicLinks.set(record.token, { ...record });
    }
    for (const entry of state.evaluationsByUserAndDay) {
      this.evaluationsByUserAndDay.set(entry.key, entry.count);
    }
  }

  private getUserOrThrow(userId: string): User {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found.`);
    }
    return user;
  }
}

export function initializeUserFromCv(
  input: InitializeUserFromCvInput,
  service: InMemoryAuthSessionService = new InMemoryAuthSessionService(),
): InitializeUserFromCvResult {
  return service.initializeUserFromCv(input);
}

export function sendMagicLink(
  request: MagicLinkSendRequest,
  service: InMemoryAuthSessionService,
  expiresInMinutes?: number,
): MagicLinkSendResponse & { expiresAt: string } {
  return service.sendMagicLink(request, expiresInMinutes);
}

export function verifyMagicLink(
  request: MagicLinkVerifyRequest,
  service: InMemoryAuthSessionService,
): MagicLinkVerifyResponse {
  return service.verifyMagicLink(request);
}

export function getAccessLevel(user: User): AccessLevel {
  return user.accountStatus === 'verified' ? 'verified' : 'temporary';
}

export function getTemporaryAccessExpiry(user: User, fallbackAt: Date, hours = 24): string {
  return user.temporarySessionExpiresAt ?? new Date(fallbackAt.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function requiresVerificationForReturnAccess(user: User): boolean {
  return user.accountStatus !== 'verified';
}

export function requiresEmailCollection(user: User): boolean {
  return !user.email;
}

export function isTemporaryAccessExpired(user: User, at: Date = new Date()): boolean {
  if (!user.temporarySessionExpiresAt) {
    return false;
  }
  return new Date(user.temporarySessionExpiresAt).getTime() <= at.getTime();
}

export function canRunEvaluation(
  user: User,
  input: {
    evaluationsToday: number;
    dailyLimit: number;
  },
): boolean {
  if (user.accountStatus !== 'verified') {
    return true;
  }
  return input.evaluationsToday < input.dailyLimit;
}
