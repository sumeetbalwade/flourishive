import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * Transactional email over SMTP. Locally this is Mailpit; in production it is
 * the ZeptoMail or SES SMTP relay (D-17), selected purely by environment.
 */
@Injectable()
export class MailService {
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
  }
}
