import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, UserStatus } from '@prisma/client';
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
import {
  InvalidCredentialsException,
  UserNotFoundException,
} from '../../../common/exceptions/domain.exceptions';
import { LoginDto } from '../dto/login.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { OtpRequestDto } from '../dto/otp-request.dto';
import { OtpVerifyDto } from '../dto/otp-verify.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { AuthResponseDto, TokenResponseDto } from '../dto/auth-response.dto';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
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

    try {
      const user = await this.users.findByEmailWithHash(dto.email);
      this.logger.debug(`Login attempt for ${dto.email}: user_found=${!!user}`);

      // Uniform failure: unknown email, wrong password, or non-active account all
      // return the same error so there is no user-enumeration signal.
      if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
        this.logger.debug(
          `Login failed for ${dto.email}: user_found=${!!user}, deleted=${user?.deletedAt}, status=${user?.status}`,
        );
        throw new InvalidCredentialsException();
      }
      const valid = await this.users.verifyPassword(user.passwordHash, dto.password);
      if (!valid) {
        this.logger.debug(`Login failed for ${dto.email}: password invalid`);
        throw new InvalidCredentialsException();
      }
      // NOTE: no transparent rehash here. password_hash is a shared column with
      // the sibling backend (bcrypt); overwriting it with argon2 would break
      // sibling logins. Dual-verify keeps both systems working.

      await this.redis.del(key);
      const pair = await this.tokens.issuePair(user, ctx);
      this.logger.debug(`Login successful for ${dto.email}`);
      return {
        ...pair,
        user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      };
    } catch (error) {
      this.logger.error(
        `Login error for ${dto.email}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async refresh(refreshToken: string, ctx: RequestCtx): Promise<TokenResponseDto> {
    const { accessToken, refreshToken: next } = await this.tokens.rotate(refreshToken, ctx);
    return { accessToken, refreshToken: next };
  }

  /** Logout = revoke all sessions + bump tokenVersion (invalidates access tokens). */
  async logout(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }

  async me(userId: string): Promise<UserResponseDto> {
    return this.users.findById(userId);
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
      throw new UserNotFoundException();
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

    const isDev = this.config.get<string>('app.nodeEnv') === 'development';
    const code = isDev ? DEV_OTP_BYPASS : String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId: user.id, code, purpose: OtpPurpose.LOGIN, expiresAt },
    });

    if (!isDev) {
      await this.mailer.sendOtp(user.email, code);
    }
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

    const user = await this.prisma.client.user.findFirst({
      where: { email: dto.email },
      include: { organization: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
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
        throw new InvalidCredentialsException();
      }
    }

    await this.redis.del(key);
    const pair = await this.tokens.issuePair(user, ctx);
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
      throw new UserNotFoundException();
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
  }
}
