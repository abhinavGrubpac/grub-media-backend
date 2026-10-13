import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import { OtpPurpose, UserStatus, type User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MailerService } from '../../mailer/mailer.service';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import { ERROR_CODES } from '../../../common/constants/error-codes';
import {
  EmailAlreadyExistsException,
  InvalidCredentialsException,
  UserNotFoundException,
} from '../../../common/exceptions/domain.exceptions';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto, USER_SORTABLE_FIELDS, UserSortField } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { ProfileUpdateDto } from '../dto/profile-update.dto';
import { ProfileOtpRequestDto } from '../../auth/dto/profile-otp-request.dto';
import { ProfileOtpVerifyDto } from '../../auth/dto/profile-otp-verify.dto';
import { ChangePasswordDto } from '../../auth/dto/change-password.dto';

const OTP_TTL_MINUTES = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  private toDto(user: User): UserResponseDto {
    return plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });
  }

  async create(dto: CreateUserDto, actorId?: string): Promise<UserResponseDto> {
    const existing = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (existing) {
      throw new EmailAlreadyExistsException();
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.client.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        createdBy: actorId,
      },
    });
    return this.toDto(user);
  }

  /** Raw row incl. passwordHash — for the auth module only. */
  async findByEmailWithHash(email: string): Promise<User | null> {
    return this.prisma.client.user.findFirst({ where: { email } });
  }

  async findById(id: string): Promise<UserResponseDto> {
    return this.toDto(await this.getOrThrow(id));
  }

  async updateProfile(id: string, dto: ProfileUpdateDto): Promise<UserResponseDto> {
    await this.getOrThrow(id);
    const user = await this.prisma.client.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        logoUrl: dto.logoUrl,
        jurisdiction: dto.jurisdiction,
      },
    });
    return this.toDto(user);
  }

  // ---------------------------------------------------------------------------
  // Profile contact update (OTP-gated)
  // ---------------------------------------------------------------------------

  async requestProfileOtp(userId: string, dto: ProfileOtpRequestDto): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) throw new InvalidCredentialsException();

    const purpose = dto.type === 'email' ? OtpPurpose.PROFILE_EMAIL : OtpPurpose.PROFILE_PHONE;

    // Invalidate any previous unused OTPs for this purpose.
    await this.prisma.otpCode.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = String(Math.floor(1000 + Math.random() * 9000));
    await this.prisma.otpCode.create({
      data: { userId, code, purpose, expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60000) },
    });

    if (dto.type === 'email') {
      await this.mailer.sendOtp(dto.value, code);
    } else {
      // SMS not yet supported — log for dev visibility.
      this.logger.log(`[DEV] Profile phone OTP for user ${userId}: ${code}`);
    }
  }

  async verifyProfileOtp(userId: string, dto: ProfileOtpVerifyDto): Promise<UserResponseDto> {
    const purpose = dto.type === 'email' ? OtpPurpose.PROFILE_EMAIL : OtpPurpose.PROFILE_PHONE;
    const claim = await this.prisma.otpCode.updateMany({
      where: { userId, code: dto.code, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (!claim.count)
      throw new BadRequestException({
        message: 'Invalid or expired OTP',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });

    if (dto.type === 'email') {
      // Check all users (incl. soft-deleted) so a deleted account's email can't be claimed.
      const existing = await this.prisma.user.findFirst({ where: { email: dto.value } });
      if (existing && existing.id !== userId)
        throw new ConflictException({
          message: 'Email already in use',
          errorCode: ERROR_CODES.CONFLICT,
        });
      await this.prisma.client.user.update({ where: { id: userId }, data: { email: dto.value } });
    } else {
      await this.prisma.client.user.update({
        where: { id: userId },
        data: { phoneNumber: dto.value },
      });
    }
    return this.findById(userId);
  }

  // ---------------------------------------------------------------------------
  // Password change (requires current password)
  // ---------------------------------------------------------------------------

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findByEmailWithHash(
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
  }

  // ---------------------------------------------------------------------------
  // Admin operations
  // ---------------------------------------------------------------------------

  async list(query: UserQueryDto): Promise<Paginated<UserResponseDto>> {
    const search = query.search?.trim();
    const where = {
      deletedAt: null,
      role: query.role,
      status: query.status,
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { employeeId: { contains: search, mode: 'insensitive' as const } },
              { phoneNumber: { contains: search, mode: 'insensitive' as const } },
              { organizationName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query);
    // Authoritatively allowlist the sort column — never pass an arbitrary
    // client string to Prisma orderBy (would 500 / leak schema internals).
    const sortField: UserSortField = USER_SORTABLE_FIELDS.includes(query.sortBy as UserSortField)
      ? (query.sortBy as UserSortField)
      : 'createdAt';
    const orderBy = { [sortField]: query.sortOrder };
    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({ where, skip, take, orderBy }),
      this.prisma.client.user.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.toDto(row)),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<UserResponseDto> {
    await this.getOrThrow(id);
    // Map known fields explicitly — never spread the DTO straight into Prisma,
    // so an unexpected key (e.g. a smuggled `password`/`role` escalation) can
    // never reach the database even if upstream validation is misconfigured.
    const user = await this.prisma.client.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        status: dto.status,
        updatedBy: actorId,
      },
    });
    return this.toDto(user);
  }

  async setStatus(id: string, status: UserStatus): Promise<UserResponseDto> {
    await this.getOrThrow(id);
    const user = await this.prisma.client.user.update({ where: { id }, data: { status } });
    return this.toDto(user);
  }

  async softDelete(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.client.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async bulkActivate(ids: string[]): Promise<number> {
    const result = await this.prisma.client.user.updateMany({
      where: { id: { in: ids }, status: UserStatus.SUSPENDED, deletedAt: null },
      data: { status: UserStatus.ACTIVE },
    });
    return result.count;
  }

  async toCsv(query: UserQueryDto): Promise<string> {
    const search = query.search?.trim();
    const rows = await this.prisma.client.user.findMany({
      where: {
        deletedAt: null,
        role: query.role,
        status: query.status,
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' as const } },
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName: { contains: search, mode: 'insensitive' as const } },
                { employeeId: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const esc = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [
      'id,email,firstName,lastName,employeeId,role,status,createdAt',
      ...rows.map((u) =>
        [
          u.id,
          u.email,
          u.firstName,
          u.lastName,
          u.employeeId,
          u.role,
          u.status,
          u.createdAt.toISOString(),
        ]
          .map(esc)
          .join(','),
      ),
    ].join('\n');
  }

  private async getOrThrow(id: string): Promise<User> {
    const user = await this.prisma.client.user.findFirst({ where: { id } });
    if (!user) {
      throw new UserNotFoundException();
    }
    return user;
  }
}
