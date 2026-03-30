import nodemailer from 'nodemailer';
import {
  getEmailFromAddress,
  getSmtpHost,
  getSmtpPassword,
  getSmtpPort,
  getSmtpSecure,
  getSmtpUser,
} from './config.js';
import { logError, logInfo } from './logging.js';

export interface EmailDeliveryMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailDeliveryResult {
  status: 'sent' | 'skipped' | 'failed';
  provider: 'smtp' | 'dev_outbox' | 'disabled';
  sentAt: string | null;
  lastAttemptAt: string;
  messageId: string | null;
  errorMessage: string | null;
}

export interface EmailDeliveryService {
  send(message: EmailDeliveryMessage): Promise<EmailDeliveryResult>;
  isConfigured(): boolean;
}

class DisabledEmailDeliveryService implements EmailDeliveryService {
  async send(): Promise<EmailDeliveryResult> {
    return {
      status: 'skipped',
      provider: 'dev_outbox',
      sentAt: null,
      lastAttemptAt: new Date().toISOString(),
      messageId: null,
      errorMessage: null,
    };
  }

  isConfigured(): boolean {
    return false;
  }
}

class SmtpEmailDeliveryService implements EmailDeliveryService {
  private readonly transporter = nodemailer.createTransport({
    host: getSmtpHost()!,
    port: getSmtpPort(),
    secure: getSmtpSecure(),
    ...(getSmtpUser()
      ? {
          auth: {
            user: getSmtpUser()!,
            pass: getSmtpPassword() ?? '',
          },
        }
      : {}),
  });

  async send(message: EmailDeliveryMessage): Promise<EmailDeliveryResult> {
    const lastAttemptAt = new Date().toISOString();
    try {
      const response = await this.transporter.sendMail({
        from: getEmailFromAddress(),
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      const sentAt = new Date().toISOString();
      logInfo('email.sent', {
        provider: 'smtp',
        to: message.to,
        messageId: response.messageId,
      });
      return {
        status: 'sent',
        provider: 'smtp',
        sentAt,
        lastAttemptAt,
        messageId: response.messageId ?? null,
        errorMessage: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown email delivery failure.';
      logError('email.failed', {
        provider: 'smtp',
        to: message.to,
        errorMessage,
      });
      return {
        status: 'failed',
        provider: 'smtp',
        sentAt: null,
        lastAttemptAt,
        messageId: null,
        errorMessage,
      };
    }
  }

  isConfigured(): boolean {
    return true;
  }
}

export function createEmailDeliveryService(): EmailDeliveryService {
  return getSmtpHost() ? new SmtpEmailDeliveryService() : new DisabledEmailDeliveryService();
}
