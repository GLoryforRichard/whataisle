import { websiteConfig } from '@/config/website';
import { getTemplate } from '@/mail/template';
import type {
  MailProvider,
  SendEmailResult,
  SendRawEmailParams,
  SendTemplateParams,
} from '@/mail/types';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * SMTP mail provider implementation
 *
 * Intended for local development against Mailpit (docker-compose service,
 * SMTP on localhost:1025, web UI on localhost:8025). Select it with
 * MAIL_PROVIDER=smtp. Production uses the Resend provider.
 */
export class SmtpProvider implements MailProvider {
  private transporter: Transporter;
  private from: string;

  constructor() {
    if (!websiteConfig.mail.fromEmail) {
      throw new Error(
        'Default from email address is not set in websiteConfig.'
      );
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
      ...(process.env.SMTP_USER
        ? {
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          }
        : {}),
    });
    this.from = websiteConfig.mail.fromEmail;
  }

  public getProviderName(): string {
    return 'smtp';
  }

  public async sendTemplate(
    params: SendTemplateParams
  ): Promise<SendEmailResult> {
    const { to, template, context, locale } = params;

    try {
      const mailTemplate = await getTemplate({
        template,
        context,
        locale,
      });

      return this.sendRawEmail({
        to,
        subject: mailTemplate.subject,
        html: mailTemplate.html,
        text: mailTemplate.text,
      });
    } catch (error) {
      console.error('Error sending template email:', error);
      return {
        success: false,
        error,
      };
    }
  }

  public async sendRawEmail(
    params: SendRawEmailParams
  ): Promise<SendEmailResult> {
    const { to, subject, html, text } = params;

    if (!this.from || !to || !subject || !html) {
      console.warn('Missing required fields for email send', {
        from: this.from,
        to,
        subject,
      });
      return {
        success: false,
        error: 'Missing required fields',
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
        text,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('Error sending email:', error);
      return {
        success: false,
        error,
      };
    }
  }
}
