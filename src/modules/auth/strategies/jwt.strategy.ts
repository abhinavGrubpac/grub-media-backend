import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
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
    if (!user || user.status !== UserStatus.ACTIVE || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException();
    }
    return { id: user.id, role: user.role, tokenVersion: user.tokenVersion };
  }
}
