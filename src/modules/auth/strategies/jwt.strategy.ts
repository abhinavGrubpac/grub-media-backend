import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole, UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service';
import type { AuthUser } from '../decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  role: string;
  tokenVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret') ?? '',
    });
  }

  /**
   * Re-check the user on every request: it must still exist (not soft-deleted —
   * the prisma.client extension excludes deleted rows), be ACTIVE, and the
   * token's `tokenVersion` must match the stored one (so "log out everywhere"
   * invalidates outstanding access tokens).
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.client.user.findFirst({ where: { id: payload.sub } });
    this.logger.debug(
      `JWT validation for user ${payload.sub}: found=${!!user}, status=${user?.status}, tokenVersion=${user?.tokenVersion} (expected=${payload.tokenVersion})`,
    );

    if (!user) {
      this.logger.warn(`JWT validation failed: user ${payload.sub} not found`);
      throw new UnauthorizedException();
    }
    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn(
        `JWT validation failed: user ${payload.sub} status is ${user.status}, not ACTIVE`,
      );
      throw new UnauthorizedException();
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      this.logger.warn(
        `JWT validation failed: user ${payload.sub} tokenVersion mismatch (stored=${user.tokenVersion}, token=${payload.tokenVersion})`,
      );
      throw new UnauthorizedException();
    }
    return { id: user.id, role: user.role as UserRole, tokenVersion: user.tokenVersion };
  }
}
