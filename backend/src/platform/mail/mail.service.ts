import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { RuntimeConfigService } from '../config/runtime-config.service.js';

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Display name for the From header (the tenant's branding.emailSenderName). */
  fromName?: string;
}

/**
 * Transactional email over SMTP. Locally this is Mailpit; in production it is the SMTP relay
 * (D-17). The server and password come from the console, else `api.env`; the connection is
 * rebuilt whenever they change.
 */
@Injectable()
export class MailService {
  private transport?: { signature: string; transporter: Transporter };

  constructor(private readonly runtime: RuntimeConfigService) {}

  private async transporter(): Promise<Transporter> {
    const [host, port, secure, user, pass] = await Promise.all([
      this.runtime.get('SMTP_HOST'),
      this.runtime.get('SMTP_PORT'),
      this.runtime.get('SMTP_SECURE'),
      this.runtime.get('SMTP_USER'),
      this.runtime.get('SMTP_PASS'),
    ]);
    const signature = JSON.stringify([host, port, secure, user, pass]);
    if (this.transport?.signature !== signature) {
      this.transport = {
        signature,
        transporter: createTransport({
          host,
          port,
          secure,
          auth: user ? { user, pass } : undefined,
        }),
      };
    }
    return this.transport.transporter;
  }

  /** The From address always comes from settings; only the display name can vary per tenant. */
  private async from(fromName?: string): Promise<string> {
    const configured = (await this.runtime.get('MAIL_FROM')) ?? '';
    if (!fromName) return configured;
    const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured;
    const name = fromName.replace(/["<>\r\n]/g, '').trim();
    return name ? `"${name}" <${address}>` : configured;
  }

  async send(message: MailMessage): Promise<void> {
    const { fromName, ...rest } = message;
    const transporter = await this.transporter();
    await transporter.sendMail({ from: await this.from(fromName), ...rest });
  }

  /** Connects and says hello without sending anything (used by the console's Test button). */
  async verifyConnection(): Promise<void> {
    await (await this.transporter()).verify();
  }
}
