import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, UserStatus, LogType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { UsersService } from '../../users/services/users.service';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { TokenService } from './token.service';
import { RedisService } from '../../../redis/redis.service';
import { PrismaService } from '../../../database/prisma.service';
import { MailerService } from '../../mailer/mailer.service';
import { ERROR_CODES } from '../../../common/constants/error-codes';
import { logRefOf } from '../../../common/utils/log-ref';
import { InvalidCredentialsException } from '../../../common/exceptions/domain.exceptions';
import { LoginDto } from '../dto/login.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { OtpRequestDto } from '../dto/otp-request.dto';
import { OtpVerifyDto } from '../dto/otp-verify.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { AuthResponseDto, TokenResponseDto } from '../dto/auth-response.dto';
import { ProfileOtpRequestDto } from '../dto/profile-otp-request.dto';
import { ProfileOtpVerifyDto } from '../dto/profile-otp-verify.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { LogsService } from '../../logs/services/logs.service';

/**
 * Log taxonomy for authentication-session events (Login / Logout / Failed
 * Login / Password). These live in the SYSTEM stream alongside other security
 * and configuration events — NOT the ACTIVITY stream, which is reserved for
 * day-to-day employee activity (Profile / Leave / Payroll / Attendance).
 * Pairing stream + category here keeps the two in sync at every call site.
 */
const AUTH_LOG = { typeEnum: LogType.SYSTEM, categoryName: 'Authentication' } as const;

interface RequestCtx {
  ip?: string;
  userAgent?: string;
}

const LOCK_TTL_SECONDS = 15 * 60;
const OTP_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_HOURS = 1;
const OTP_REQ_RATE_MAX = 3;

// In development mode this bypass code skips the DB OTP lookup so engineers
// can test flows without a real email inbox.
const DEV_OTP_BYPASS = '1234';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly logs: LogsService,
  ) {}

  async login(dto: LoginDto, ctx: RequestCtx): Promise<AuthResponseDto> {
    const key = `login:${dto.email}:${ctx.ip ?? 'unknown'}`;
    const attempts = await this.redis.increment(key, LOCK_TTL_SECONDS);
    if (attempts > this.config.get<number>('throttle.loginLockMax', 5)) {
      throw new ForbiddenException({
        message: 'Too many failed login attempts. Try again later.',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }

    const user = await this.users.findByEmailWithHash(dto.email);
    // Uniform failure: unknown email, wrong password, or non-active account all
    // return the same error so there is no user-enumeration signal.
    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      await this.recordFailedLogin(dto.email, ctx);
      throw new InvalidCredentialsException();
    }
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      await this.recordFailedLogin(dto.email, ctx);
      throw new InvalidCredentialsException();
    }

    await this.redis.del(key);
    const pair = await this.tokens.issuePair(user, ctx);
    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'Login',
      actionText: `User ${user.email} logged in from ${ctx.ip ?? 'unknown'}`,
      userId: user.id,
      target: logRefOf(user),
    });
    return {
      ...pair,
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
    };
  }

  /**
   * Audit a failed sign-in attempt (password or OTP). The row is recorded
   * against the email as text (the user may not exist), so failed attempts for
   * unknown emails are visible to admins without a userId FK. The action name
   * distinguishes the two flows: 'Failed Login' vs 'Failed OTP'.
   */
  private async recordFailedLogin(
    email: string,
    ctx: RequestCtx,
    kind: 'login' | 'otp' = 'login',
  ): Promise<void> {
    const actionName = kind === 'otp' ? 'Failed OTP' : 'Failed Login';
    const what = kind === 'otp' ? 'OTP' : 'login';
    await this.logs.record({
      ...AUTH_LOG,
      actionName,
      actionText: `Failed ${what} attempt for ${email} from ${ctx.ip ?? 'unknown'}`,
      target: email,
    });
  }

  async refresh(refreshToken: string, ctx: RequestCtx): Promise<TokenResponseDto> {
    const { accessToken, refreshToken: next, userId } = await this.tokens.rotate(refreshToken, ctx);
    // Best-effort: resolve the actor so the audit reference is human-readable.
    const actor = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, employeeId: true },
    });
    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'Token Refresh',
      actionText: `Access token refreshed for ${actor?.email ?? userId} from ${ctx.ip ?? 'unknown'}`,
      userId,
      target: logRefOf(actor ?? { id: userId, email: null, employeeId: null }),
    });
    return { accessToken, refreshToken: next };
  }

  /** Logout = revoke all sessions + bump tokenVersion (invalidates access tokens). */
  async logout(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    // Resolve the actor's employeeId/email so the audit reference is readable
    // (EMP-### / email) rather than a raw cuid. Best-effort: on lookup failure
    // the log still records the raw id.
    const actor = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, employeeId: true },
    });
    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'Logout',
      actionText: `User ${actor?.email ?? userId} logged out`,
      userId,
      target: logRefOf(actor ?? { id: userId, email: null, employeeId: null }),
    });
  }

  async me(userId: string): Promise<UserResponseDto> {
    return this.users.findById(userId);
  }

  async requestProfileOtp(userId: string, dto: ProfileOtpRequestDto): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new InvalidCredentialsException();
    if (dto.type === 'email' && !/^\S+@\S+\.\S+$/.test(dto.value))
      throw new BadRequestException('Invalid email');
    const purpose = dto.type === 'email' ? OtpPurpose.PROFILE_EMAIL : OtpPurpose.PROFILE_PHONE;
    const code = String(Math.floor(1000 + Math.random() * 9000));
    await this.prisma.client.otpCode.create({
      data: { userId, code, purpose, expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60000) },
    });
    this.logger.log(`Profile ${dto.type} OTP for ${userId}: ${code}`);

    await this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'OTP Requested',
      actionText: `Profile ${dto.type} change OTP requested by ${logRefOf(user)}`,
      userId,
      target: logRefOf(user),
    });
  }

  async verifyProfileOtp(userId: string, dto: ProfileOtpVerifyDto): Promise<UserResponseDto> {
    const purpose = dto.type === 'email' ? OtpPurpose.PROFILE_EMAIL : OtpPurpose.PROFILE_PHONE;
    const claim = await this.prisma.client.otpCode.updateMany({
      where: { userId, code: dto.code, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (!claim.count) {
      // Audit the failed verification alongside the profile flow's other rows
      // (ACTIVITY/Profile), so rejected OTP attempts are visible to admins.
      await this.logs.record({
        typeEnum: LogType.ACTIVITY,
        categoryName: 'Profile',
        actionName: 'Failed OTP',
        actionText: `Failed profile ${dto.type} OTP verification for user ${userId}`,
        userId,
        target: userId,
      });
      throw new BadRequestException('Invalid or expired OTP');
    }
    const before = await this.prisma.client.user.findUnique({ where: { id: userId } });
    const oldField = dto.type === 'email' ? before?.email : before?.phoneNumber;
    if (dto.type === 'email') {
      const existing = await this.prisma.client.user.findUnique({ where: { email: dto.value } });
      if (existing && existing.id !== userId) throw new ConflictException('Email already in use');
      await this.prisma.client.user.update({ where: { id: userId }, data: { email: dto.value } });
    } else
      await this.prisma.client.user.update({
        where: { id: userId },
        data: { phoneNumber: dto.value },
      });
    await this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'Update Profile',
      actionText: `Verified ${dto.type} changed to ${dto.value} for user ${before?.email ?? userId}`,
      userId,
      target: logRefOf(before ?? { id: userId, email: null, employeeId: null }),
      oldDetail: { [dto.type]: oldField ?? null },
      newDetail: { [dto.type]: dto.value },
    });
    return this.users.findById(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.findByEmailWithHash(
      (await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })).email,
    );
    if (!user || !(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new InvalidCredentialsException();
    }
    if (await argon2.verify(user.passwordHash, dto.newPassword)) {
      throw new BadRequestException({
        message: 'New password must differ from the current password',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.newPassword), tokenVersion: { increment: 1 } },
    });
    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'Password Changed',
      actionText: `Password changed for ${user.email}`,
      userId,
      target: logRefOf(user),
    });
  }

  // ---------------------------------------------------------------------------
  // OTP login
  // ---------------------------------------------------------------------------

  async requestOtpLogin(dto: OtpRequestDto, ctx: RequestCtx = {}): Promise<void> {
    // Rate-limit per email+IP. Since we reveal user existence, rate limiting
    // is the primary guard against enumeration and inbox flooding.
    const rlKey = `otp-req:${dto.email}:${ctx.ip ?? 'unknown'}`;
    const rlCount = await this.redis.increment(rlKey, LOCK_TTL_SECONDS);
    if (rlCount > OTP_REQ_RATE_MAX) {
      throw new ForbiddenException({
        message: 'Too many OTP requests. Try again later.',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }

    const user = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (!user) {
      // No enumeration: unknown emails receive the same silent 200 as known
      // ones, so an attacker can't probe which addresses have accounts.
      return;
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        message: 'Account is not active',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }

    // Invalidate any outstanding unused OTPs before issuing a fresh one so
    // only the latest code is valid (prevents parallel-use attacks).
    await this.prisma.otpCode.updateMany({
      where: { userId: user.id, purpose: OtpPurpose.LOGIN, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId: user.id, code, purpose: OtpPurpose.LOGIN, expiresAt },
    });

    await this.mailer.sendOtp(user.email, code);

    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'OTP Requested',
      actionText: `Login OTP requested for ${user.email} from ${ctx.ip ?? 'unknown'}`,
      userId: user.id,
      target: logRefOf(user),
    });
  }

  async verifyOtpLogin(dto: OtpVerifyDto, ctx: RequestCtx): Promise<AuthResponseDto> {
    const key = `otp:${dto.email}:${ctx.ip ?? 'unknown'}`;
    const attempts = await this.redis.increment(key, LOCK_TTL_SECONDS);
    if (attempts > this.config.get<number>('throttle.loginLockMax', 5)) {
      throw new ForbiddenException({
        message: 'Too many failed attempts. Try again later.',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }

    const user = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.recordFailedLogin(dto.email, ctx, 'otp');
      throw new InvalidCredentialsException();
    }

    const isDev = this.config.get<string>('app.nodeEnv') === 'development';
    const isDevBypass = isDev && dto.code === DEV_OTP_BYPASS;

    if (!isDevBypass) {
      const claim = await this.prisma.otpCode.updateMany({
        where: {
          userId: user.id,
          code: dto.code,
          purpose: OtpPurpose.LOGIN,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (claim.count === 0) {
        await this.recordFailedLogin(dto.email, ctx, 'otp');
        throw new InvalidCredentialsException();
      }
    }

    await this.redis.del(key);
    const pair = await this.tokens.issuePair(user, ctx);
    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'Login',
      actionText: `User ${user.email} logged in via OTP from ${ctx.ip ?? 'unknown'}`,
      userId: user.id,
      target: logRefOf(user),
    });
    return {
      ...pair,
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
    };
  }

  // ---------------------------------------------------------------------------
  // Forgot / reset password
  // ---------------------------------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (!user) {
      // No enumeration: unknown emails receive the same silent 200 as known
      // ones, so an attacker can't probe which addresses have accounts.
      return;
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        message: 'Account is not active',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }

    // Invalidate any outstanding unused reset tokens so only the newest link works.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawSecret = randomBytes(32).toString('base64url');
    const hashedToken = await argon2.hash(rawSecret);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const row = await this.prisma.passwordResetToken.create({
      data: { userId: user.id, hashedToken, expiresAt },
    });

    // Token format: `${id}.${rawSecret}` — id is the O(1) lookup key.
    const token = `${row.id}.${rawSecret}`;
    await this.mailer.sendPasswordResetLink(user.email, token);
    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'Password Reset',
      actionText: `Password reset requested for ${user.email}`,
      userId: user.id,
      target: logRefOf(user),
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const dot = dto.token.indexOf('.');
    if (dot === -1) {
      throw new BadRequestException({
        message: 'Invalid or expired reset token',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }
    const id = dto.token.slice(0, dot);
    const rawSecret = dto.token.slice(dot + 1);

    const row = await this.prisma.passwordResetToken.findFirst({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!row || !(await argon2.verify(row.hashedToken, rawSecret))) {
      throw new BadRequestException({
        message: 'Invalid or expired reset token',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }

    // Don't let an inactive or suspended account reset its password.
    if (row.user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException({
        message: 'Invalid or expired reset token',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }

    // Atomic single-use claim.
    const claim = await this.prisma.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BadRequestException({
        message: 'Invalid or expired reset token',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }

    const passwordHash = await argon2.hash(dto.password);
    await this.prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });
    await this.logs.record({
      ...AUTH_LOG,
      actionName: 'Password Reset',
      actionText: `Password reset completed for ${row.user.email}`,
      userId: row.userId,
      target: logRefOf(row.user),
    });
  }
}
