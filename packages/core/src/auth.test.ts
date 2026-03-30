import { describe, expect, it } from 'vitest';
import type { User } from '@career-rafiq/contracts';
import {
  InMemoryAuthSessionService,
  canRunEvaluation,
  getAccessLevel,
  initializeUserFromCv,
  sendMagicLink,
  verifyMagicLink,
} from './auth.js';

function createVerifiedUser(id = 'usr_verified'): User {
  return {
    id,
    email: 'verified@example.com',
    defaultCvId: null,
    accountStatus: 'verified',
    emailVerificationStatus: 'verified',
    authMethod: 'magic_link',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastVerifiedLoginAt: '2026-01-01T00:00:00.000Z',
    temporarySessionExpiresAt: null,
  };
}

describe('auth/session module', () => {
  it('creates a temporary user when CV parsing finds no email', () => {
    const result = initializeUserFromCv({
      detectedEmails: [],
      temporarySessionHours: 2,
    });

    expect(result.selectedEmail).toBeNull();
    expect(result.user.accountStatus).toBe('temporary');
    expect(result.user.emailVerificationStatus).toBe('unverified');
    expect(result.user.temporarySessionExpiresAt).not.toBeNull();
    expect(getAccessLevel(result.user)).toBe('temporary');
    expect(result.warnings).toContain('No email detected; created temporary session user.');
  });

  it('creates an unverified user when email is detected and can verify via magic link', () => {
    const service = new InMemoryAuthSessionService();
    const init = service.initializeUserFromCv({
      detectedEmails: ['Candidate@Example.com'],
    });

    expect(init.user.accountStatus).toBe('unverified');
    expect(init.user.email).toBe('candidate@example.com');

    const sent = sendMagicLink(
      {
        userId: init.user.id,
        email: 'Candidate@Example.com',
      },
      service,
      30,
    );

    const verified = verifyMagicLink(
      {
        token: sent.token,
        email: 'candidate@example.com',
      },
      service,
    );

    expect(verified.verified).toBe(true);
    expect(verified.userId).toBe(init.user.id);
    expect(verified.accessLevel).toBe('verified');

    const stored = service.getUser(init.user.id);
    expect(stored?.accountStatus).toBe('verified');
    expect(stored?.emailVerificationStatus).toBe('verified');
    expect(stored?.lastVerifiedLoginAt).not.toBeNull();
    expect(getAccessLevel(stored!)).toBe('verified');
  });

  it('rejects verification when token is expired or email mismatch', () => {
    const clock = {
      now: new Date('2026-03-01T00:00:00.000Z'),
    };
    const service = new InMemoryAuthSessionService(() => clock.now);
    const init = service.initializeUserFromCv({
      detectedEmails: ['user@example.com'],
    });
    const sent = service.sendMagicLink({ userId: init.user.id, email: 'user@example.com' }, 1);

    const mismatch = service.verifyMagicLink({
      token: sent.token,
      email: 'other@example.com',
    });
    expect(mismatch.verified).toBe(false);

    clock.now = new Date('2026-03-01T00:05:00.000Z');
    const expired = verifyMagicLink(
      {
        token: sent.token,
        email: 'user@example.com',
      },
      service,
    );

    expect(expired.verified).toBe(false);
    expect(expired.userId).toBeNull();
    expect(expired.accessLevel).toBe('temporary');
  });

  it('allows non-verified users to run evaluations but gates verified users by daily limit', () => {
    const start = new Date('2026-03-10T09:00:00.000Z');
    const service = new InMemoryAuthSessionService(() => start);
    const temp = service.initializeUserFromCv({ detectedEmails: [] }).user;

    expect(service.canRunEvaluation(temp, { dailyLimit: 1 })).toBe(true);
    expect(
      canRunEvaluation(createVerifiedUser(), {
        evaluationsToday: 1,
        dailyLimit: 1,
      }),
    ).toBe(false);

    const verifiedInit = service.initializeUserFromCv({
      detectedEmails: ['verified@example.com'],
    });
    const link = service.sendMagicLink({
      userId: verifiedInit.user.id,
      email: 'verified@example.com',
    });
    service.verifyMagicLink({
      token: link.token,
      email: 'verified@example.com',
    });

    const verified = service.getUser(verifiedInit.user.id);
    expect(verified?.accountStatus).toBe('verified');
    expect(service.canRunEvaluation(verified!, { dailyLimit: 2, at: start })).toBe(true);

    service.noteEvaluationCompleted(verified!.id, start);
    service.noteEvaluationCompleted(verified!.id, start);

    expect(service.canRunEvaluation(verified!, { dailyLimit: 2, at: start })).toBe(false);
    expect(service.canRunEvaluation(verified!, { dailyLimit: 2, at: new Date('2026-03-11T09:00:00.000Z') })).toBe(true);
  });

  it('round-trips auth session state for persistence', () => {
    const service = new InMemoryAuthSessionService(() => new Date('2026-03-15T09:00:00.000Z'));
    const initialized = service.initializeUserFromCv({
      detectedEmails: ['persisted@example.com'],
    });
    const link = service.sendMagicLink({
      userId: initialized.user.id,
      email: 'persisted@example.com',
    });
    service.noteEvaluationCompleted(initialized.user.id, new Date('2026-03-15T09:00:00.000Z'));

    const restored = new InMemoryAuthSessionService(() => new Date('2026-03-15T09:00:00.000Z'));
    restored.importState(service.exportState());

    const verified = restored.verifyMagicLink({
      token: link.token,
      email: 'persisted@example.com',
    });

    expect(verified.verified).toBe(true);
    expect(restored.canRunEvaluation(restored.getUser(initialized.user.id)!, { dailyLimit: 2 })).toBe(true);
    restored.noteEvaluationCompleted(initialized.user.id, new Date('2026-03-15T09:00:00.000Z'));
    expect(restored.canRunEvaluation(restored.getUser(initialized.user.id)!, { dailyLimit: 2 })).toBe(false);
  });
});
