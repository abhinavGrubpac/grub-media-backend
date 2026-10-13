import { registerAs } from '@nestjs/config';

export default registerAs('mailer', () => ({
  configured: !!process.env.SMTP_HOST,
  host: process.env.SMTP_HOST ?? 'localhost',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM ?? 'noreply@grubpac.com',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  secure: process.env.SMTP_SECURE === 'true',
}));
