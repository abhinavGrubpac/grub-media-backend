import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { User, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../database/prisma.service';

interface SessionCtx {
  ip?: string;
  userAgent?: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

type SessionUser = Pick<User, 'id' | 'role' | 'status' | 'tokenVersion' | 'deletedAt'>;

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Issues access tokens and manages DB-persisted, argon2-hashed, rotating refresh
 * tokens.
 *
 * Refresh token format: `${sessionId}.${secret}`. Only the argon2 hash of the
 * secret is stored; the sessionId is the (non-sensitive) primary-key selector,
 * giving an O(1) lookup + a single argon2 verify per refresh (no global scan).
 *
 * Rotation is atomic: the presented session is revoked with a conditional
 * `updateMany(... revokedAt: null)` BEFORE a new pair is issued. If that update
 * affects zero rows the token was already rotated — treated as reuse/theft, and
 * the entire session family is revoked (and tokenVersion bumped) so outstanding
 * access tokens die immediately.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private signAccess(user: Pick<User, 'id' | 'role' | 'tokenVersion'>): Promise<string> {
    const options = {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessTtl'),
    } as JwtSignOptions;
    return this.jwt.signAsync(
      { sub: user.id, role: user.role, tokenVersion: user.tokenVersion },
      options,
    );
  }

  private assertActive(user: Pick<User, 'deletedAt' | 'status'>): void {
    if (user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
  }

  async issuePair(user: SessionUser, ctx: SessionCtx): Promise<TokenPair> {
    this.assertActive(user); // defense-in-depth: never mint tokens for a disabled user
    const secret = randomBytes(32).toString('base64url');
    const hashedToken = await argon2.hash(secret, { type: argon2.argon2id });
    const session = await this.prisma.client.session.create({
      data: {
        userId: user.id,
        hashedToken,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const accessToken = await this.signAccess(user);
    return { accessToken, refreshToken: `${session.id}.${secret}` };
  }

  async rotate(presentedToken: string, ctx: SessionCtx): Promise<TokenPair & { userId: string }> {
    const sep = presentedToken.indexOf('.');
    if (sep < 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const sessionId = presentedToken.slice(0, sep);
    const secret = presentedToken.slice(sep + 1);
    if (!secret) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.client.session.findFirst({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!session || !(await argon2.verify(session.hashedToken, secret))) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Atomic single-use revoke. Zero rows affected => already rotated => reuse.
    // This runs regardless of expiry, so a stolen-and-expired token is still
    // caught as reuse rather than silently failing.
    const revoked = await this.prisma.client.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    this.assertActive(session.user); // R4: no rotation for soft-deleted/inactive users

    const pair = await this.issuePair(session.user, ctx);
    return { ...pair, userId: session.userId };
  }

  /**
   * Revoke every live session for a user AND bump tokenVersion in one
   * transaction, so outstanding access tokens immediately fail JwtStrategy.
   * Used by logout and by reuse/theft response.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.client.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}
