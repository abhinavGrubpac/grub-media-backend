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
 * tokens. Rotation revokes the old session and, on reuse of an already-rotated
 * token, revokes the entire session family (likely token theft).
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

  async issuePair(user: SessionUser, ctx: SessionCtx): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    const hashedToken = await argon2.hash(refreshToken, { type: argon2.argon2id });
    await this.prisma.client.session.create({
      data: {
        userId: user.id,
        hashedToken,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const accessToken = await this.signAccess(user);
    return { accessToken, refreshToken };
  }

  async rotate(presentedToken: string, ctx: SessionCtx): Promise<TokenPair & { userId: string }> {
    const candidates = await this.prisma.client.session.findMany({
      where: { expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    let match: (typeof candidates)[number] | undefined;
    for (const session of candidates) {
      if (await argon2.verify(session.hashedToken, presentedToken)) {
        match = session;
        break;
      }
    }
    if (!match) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse of an already-rotated/revoked token => likely theft: nuke the family.
    if (match.revokedAt) {
      await this.revokeAllForUser(match.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const user = match.user;
    if (user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    const pair = await this.issuePair(user, ctx);
    await this.prisma.client.session.update({
      where: { id: match.id },
      data: { revokedAt: new Date() },
    });
    return { ...pair, userId: match.userId };
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
