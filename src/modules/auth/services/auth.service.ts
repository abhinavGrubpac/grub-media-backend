import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, UserStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import { UsersService } from '../../users/services/users.service';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { TokenService } from './token.service';
import { RedisService } from '../../../redis/redis.service';
import { PrismaService } from '../../../database/prisma.service';
import { MailerService } from '../../mailer/mailer.service';
import { ERROR_CODES } from '../../../common/constants/error-codes';
import { InvalidCredentialsException } from '../../../common/exceptions/domain.exceptions';
import { LoginDto } from '../dto/login.dto';
import { OtpRequestDto } from '../dto/otp-request.dto';
import { OtpVerifyDto } from '../dto/otp-verify.dto';
import { AuthResponseDto, TokenResponseDto } from '../dto/auth-response.dto';

interface RequestCtx {
  ip?: string;
  userAgent?: string;
}

const LOCK_TTL_SECONDS = 15 * 60;
const OTP_TTL_MINUTES = 10;

@Injectable()
export class AuthService {
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

    const user = await this.users.findByEmailWithHash(dto.email);
    // Uniform failure for unknown email, wrong password, or inactive/deleted
    // account — no user-enumeration signal.
    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new InvalidCredentialsException();
    }
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new InvalidCredentialsException();
    }

    await this.redis.del(key);
    const pair = await this.tokens.issuePair(user, ctx);
    return {
      ...pair,
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
    };
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

  async requestOtpLogin(dto: OtpRequestDto): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      // No-op: never reveal whether the email exists.
      return;
    }

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId: user.id, code, purpose: OtpPurpose.LOGIN, expiresAt },
    });

    await this.mailer.sendOtp(user.email, code);
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
    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new InvalidCredentialsException();
    }

    // Atomic single-use claim: only update a row that hasn't been used yet.
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

    await this.redis.del(key);
    const pair = await this.tokens.issuePair(user, ctx);
    return {
      ...pair,
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
    };
  }
}
