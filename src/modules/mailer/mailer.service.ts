import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter!: Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('mailer.host'),
      port: this.config.get<number>('mailer.port'),
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
    const from = this.config.get<string>('mailer.from');
    await this.transporter.sendMail({
      from,
      to,
      subject: 'Your GrubPac login code',
      text: `Your login code is: ${code}\n\nThis code expires in 10 minutes. Do not share it.`,
      html: `<p>Your login code is: <strong>${code}</strong></p><p>This code expires in 10 minutes. Do not share it.</p>`,
    });
    this.logger.log({ msg: 'OTP email sent', to });
  }

  async sendPasswordResetLink(to: string, token: string): Promise<void> {
    const from = this.config.get<string>('mailer.from');
    const frontendUrl = this.config.get<string>('mailer.frontendUrl');
    const link = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.transporter.sendMail({
      from,
      to,
      subject: 'Reset your GrubPac password',
      text: `Click the link below to reset your password:\n\n${link}\n\nThis link expires in 1 hour.`,
      html: `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`,
    });
    this.logger.log({ msg: 'Password reset email sent', to });
  }
}
