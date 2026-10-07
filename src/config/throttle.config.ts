import { registerAs } from '@nestjs/config';

export default registerAs('throttle', () => ({
  // milliseconds — @nestjs/throttler v6 expects ttl in ms
  ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  // max failed login attempts (per email+ip) before lockout (R1)
  loginLockMax: parseInt(process.env.THROTTLE_LOGIN_LOCK_MAX ?? '5', 10),
}));
