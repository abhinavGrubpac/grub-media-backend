import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter!: Transporter;
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('mailer.host');
    const port = this.config.get<number>('mailer.port');

    // Only treat SMTP as configured when a real host is set in the environment.
    // Defaulting to localhost:587 without an actual server causes ECONNREFUSED.
    this.configured = this.config.get<boolean>('mailer.configured', false);

    if (!this.configured) {
      this.logger.warn('SMTP_HOST is not set — emails will be logged to console instead of sent.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: this.config.get<boolean>('mailer.secure', false),
      auth: this.config.get<string | undefined>('mailer.user')
        ? {
            user: this.config.get<string>('mailer.user'),
            pass: this.config.get<string>('mailer.pass'),
          }
        : undefined,
    });
  }

  async sendOtp(to: string, code: string): Promise<void> {
    if (!this.configured) {
      this.logger.log(`[DEV] OTP for ${to}: ${code}`);
      return;
    }

    const from = this.config.get<string>('mailer.from');
    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Your GrubPac login code',
        text: `Your login code is: ${code}\n\nThis code expires in 10 minutes. Do not share it.`,
        html: `<p>Your login code is: <strong>${code}</strong></p><p>This code expires in 10 minutes. Do not share it.</p>`,
      });
      this.logger.log({ msg: 'OTP email sent', to });
    } catch (err) {
      this.logger.error({ msg: 'Failed to send OTP email', to, err });
      throw new ServiceUnavailableException('Unable to send OTP email. Please try again later.');
    }
  }

  async sendPasswordResetLink(to: string, token: string): Promise<void> {
    const frontendUrl = this.config.get<string>('mailer.frontendUrl');
    const link = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    if (!this.configured) {
      this.logger.log(`[DEV] Password reset link for ${to}: ${link}`);
      return;
    }

    const from = this.config.get<string>('mailer.from');
    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Reset your GrubPac password',
        text: `Click the link below to reset your password:\n\n${link}\n\nThis link expires in 1 hour.`,
        html: `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`,
      });
      this.logger.log({ msg: 'Password reset email sent', to });
    } catch (err) {
      this.logger.error({ msg: 'Failed to send password reset email', to, err });
      throw new ServiceUnavailableException(
        'Unable to send password reset email. Please try again later.',
      );
    }
  }
}
