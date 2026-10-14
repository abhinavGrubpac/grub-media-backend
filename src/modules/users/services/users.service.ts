import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import { OtpPurpose, Organization, UserRole, UserStatus, type User } from '@prisma/client';
import { randomBytes } from 'crypto';
import { UserStatus, LogType, type User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { logRefOf } from '../../../common/utils/log-ref';
import { MailerService } from '../../mailer/mailer.service';
import { StorageService } from '../../storage/storage.service';
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
import { ExportUsersDto } from '../dto/export-users.dto';
import { UserQueryDto, USER_SORTABLE_FIELDS, UserSortField } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { ProfileUpdateDto } from '../dto/profile-update.dto';
import { ProfileOtpRequestDto } from '../../auth/dto/profile-otp-request.dto';
import { ProfileOtpVerifyDto } from '../../auth/dto/profile-otp-verify.dto';
import { ChangePasswordDto } from '../../auth/dto/change-password.dto';

const OTP_TTL_MINUTES = 10;
const DEV_OTP_BYPASS = '1234';
import { LogsService } from '../../logs/services/logs.service';

/** Log taxonomy names for user management events (Log System EMPLOYEE stream). */
const LOG_CATEGORY = {
  onboarding: 'Onboarding',
  employment: 'Employment',
  exit: 'Exit',
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly logs: LogsService,
  ) {}

  private toDto(user: User & { organization?: Organization | null }): UserResponseDto {
    return plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });
  }

  /**
   * Enforces role hierarchy: only SUPER_ADMIN can act on SUPER_ADMIN accounts
   * or promote someone to SUPER_ADMIN. ADMINs are limited to EMPLOYEE targets.
   */
  private assertHierarchy(actorRole: UserRole, targetRole: UserRole, newRole?: UserRole): void {
    if (actorRole === UserRole.SUPER_ADMIN) return; // super admin can do anything
    if (targetRole === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({
        message: 'Admins cannot modify a Super Admin account',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }
    if (newRole === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({
        message: 'Only a Super Admin can promote a user to Super Admin',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(dto: CreateUserDto, actorId: string, actorRole: UserRole): Promise<UserResponseDto> {
    // Only SUPER_ADMIN can create a SUPER_ADMIN account.
    if (dto.role === UserRole.SUPER_ADMIN && actorRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({
        message: 'Only a Super Admin can create a Super Admin account',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }
    const existing = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (existing) throw new EmailAlreadyExistsException();

    // If admin doesn't supply a password, generate a secure random one.
    // The employee must use "forgot password" to set their own before logging in.
    const rawPassword = dto.password ?? randomBytes(16).toString('base64url');
    const passwordHash = await argon2.hash(rawPassword, { type: argon2.argon2id });

    const user = await this.prisma.client.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        employeeId: dto.employeeId,
        jurisdiction: dto.jurisdiction,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
        organizationId: dto.organizationId,
        role: dto.role,
        createdBy: actorId,
      },
      include: { organization: true },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.onboarding,
      actionName: 'Create Employee',
      actionText: `Employee ${user.email} created by ${actorId ?? 'system'}`,
      userId: actorId,
      empId: user.id,
      referenceId: logRefOf(user),
      newDetail: this.toDto(user),
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.onboarding,
      actionName: 'Create Employee',
      actionText: `Employee ${user.email} created by ${actorId ?? 'system'}`,
      userId: actorId,
      empId: user.id,
      target: logRefOf(user),
      newDetail: this.toDto(user),
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
    const before = await this.getOrThrow(id);
    const user = await this.prisma.client.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        avatarUrl: dto.avatarUrl,
        jurisdiction: dto.jurisdiction,
      },
      include: { organization: true },
    });
    return this.toDto(user);
  }

  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<UserResponseDto> {
    const user = await this.getOrThrow(userId);

    // Delete old avatar from S3 before replacing (fire-and-forget on failure)
    if (user.avatarUrl) {
      void this.storage.deleteByUrl(user.avatarUrl);
    }

    const avatarUrl = await this.storage.uploadImage('avatars', userId, file);
    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: { avatarUrl },
      include: { organization: true },
    });
    return this.toDto(updated);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
    actorRole: UserRole,
  ): Promise<UserResponseDto> {
    const target = await this.getOrThrow(id);
    this.assertHierarchy(actorRole, target.role, dto.role);

    const user = await this.prisma.client.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        employeeId: dto.employeeId,
        jurisdiction: dto.jurisdiction,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
        organizationId: dto.organizationId,
        role: dto.role,
        updatedBy: actorId,
      },
      include: { organization: true },
    });
    return this.toDto(user);
  }

  // ---------------------------------------------------------------------------
  // Status transitions (dedicated endpoints — never via generic PATCH)
  // ---------------------------------------------------------------------------

  async suspend(id: string, actorId: string, actorRole: UserRole): Promise<UserResponseDto> {
    if (id === actorId) {
      throw new ForbiddenException({
        message: 'You cannot suspend your own account',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }
    const target = await this.getOrThrow(id);
    this.assertHierarchy(actorRole, target.role);

    if (target.status === UserStatus.SUSPENDED) {
      throw new BadRequestException({
        message: 'User is already suspended',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }
    const user = await this.prisma.client.user.update({
      where: { id },
      data: { status: UserStatus.SUSPENDED, updatedBy: actorId },
      include: { organization: true },
    });
    return this.toDto(user);
  }

  async activate(id: string, actorId: string, actorRole: UserRole): Promise<UserResponseDto> {
    const target = await this.getOrThrow(id);
    this.assertHierarchy(actorRole, target.role);

    if (target.status === UserStatus.ACTIVE) {
      throw new BadRequestException({
        message: 'User is already active',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }
    const user = await this.prisma.client.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE, updatedBy: actorId },
      include: { organization: true },
    });
    return this.toDto(user);
  }

  /** Dismiss = set INACTIVE. The account cannot log in but is not deleted. */
  async dismiss(id: string, actorId: string, actorRole: UserRole): Promise<UserResponseDto> {
    if (id === actorId) {
      throw new ForbiddenException({
        message: 'You cannot dismiss your own account',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }
    const target = await this.getOrThrow(id);
    this.assertHierarchy(actorRole, target.role);

    if (target.status === UserStatus.INACTIVE) {
      throw new BadRequestException({
        message: 'User is already inactive',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }
    const user = await this.prisma.client.user.update({
      where: { id },
      data: { status: UserStatus.INACTIVE, updatedBy: actorId },
      include: { organization: true },
    });
    await this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'Update Profile',
      actionText: `Profile details updated for ${user.email}`,
      userId: id,
      empId: user.id,
      target: logRefOf(user),
      oldDetail: this.toDto(before),
      newDetail: this.toDto(user),
    });
    return this.toDto(user);
  }

  async softDelete(id: string, actorId: string, actorRole: UserRole): Promise<void> {
    if (id === actorId) {
      throw new ForbiddenException({
        message: 'You cannot delete your own account',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }
    const target = await this.getOrThrow(id);
    this.assertHierarchy(actorRole, target.role);

    await this.prisma.client.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------
  // Bulk / admin utilities
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
      this.prisma.client.user.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { organization: true },
      }),
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
    const before = await this.getOrThrow(id);
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
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.employment,
      actionName: 'Update Employee',
      actionText: `Employee ${user.email} updated by ${actorId}`,
      userId: actorId,
      empId: user.id,
      target: logRefOf(user),
      oldDetail: this.toDto(before),
      newDetail: this.toDto(user),
    });
    return this.toDto(user);
  }

  async setStatus(id: string, status: UserStatus, actorId?: string): Promise<UserResponseDto> {
    const before = await this.getOrThrow(id);
    const user = await this.prisma.client.user.update({ where: { id }, data: { status } });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.employment,
      actionName: 'Status Change',
      actionText: `Employee ${user.email} status changed from ${before.status} to ${status} by ${actorId ?? 'system'}`,
      userId: actorId,
      empId: user.id,
      target: logRefOf(user),
      oldDetail: { status: before.status },
      newDetail: { status },
    });
    return this.toDto(user);
  }

  async softDelete(id: string, actorId?: string): Promise<void> {
    const before = await this.getOrThrow(id);
    await this.prisma.client.user.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.exit,
      actionName: 'Delete Employee',
      actionText: `Employee ${before.email} deleted by ${actorId ?? 'system'}`,
      userId: actorId,
      empId: before.id,
      target: logRefOf(before),
      oldDetail: this.toDto(before),
    });
  }

  async bulkActivate(ids: string[], actorId?: string): Promise<number> {
    const result = await this.prisma.client.user.updateMany({
      where: {
        id: { in: ids },
        status: { in: [UserStatus.SUSPENDED, UserStatus.INACTIVE] },
        deletedAt: null,
      },
      data: { status: UserStatus.ACTIVE },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.employment,
      actionName: 'Bulk Activate',
      actionText: `${result.count} employee(s) reactivated by ${actorId ?? 'system'}`,
      userId: actorId,
      target: ids.join(','),
      oldDetail: { ids, fromStatus: UserStatus.SUSPENDED },
      newDetail: { ids, activated: result.count },
    });
    return result.count;
  }

  async exportCsv(dto: ExportUsersDto): Promise<string> {
    const search = dto.search?.trim();
    const statusMap = {
      all: undefined,
      active: 'ACTIVE',
      suspended: 'SUSPENDED',
      dismissed: 'INACTIVE',
      selected: undefined,
    } as const;

    const where =
      dto.type === 'selected'
        ? { id: { in: dto.ids ?? [] }, deletedAt: null }
        : {
            deletedAt: null,
            role: dto.role,
            status: statusMap[dto.type],
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

    const rows = await this.prisma.client.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const esc = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [
      'id,email,firstName,lastName,phoneNumber,employeeId,jurisdiction,role,status,joiningDate,createdAt',
      ...rows.map((u) =>
        [
          u.id,
          u.email,
          u.firstName,
          u.lastName,
          u.phoneNumber,
          u.employeeId,
          u.jurisdiction,
          u.role,
          u.status,
          u.joiningDate?.toISOString(),
          u.createdAt.toISOString(),
        ]
          .map(esc)
          .join(','),
      ),
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Profile contact update (OTP-gated)
  // ---------------------------------------------------------------------------

  async requestProfileOtp(userId: string, dto: ProfileOtpRequestDto): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) throw new InvalidCredentialsException();

    const purpose = dto.type === 'email' ? OtpPurpose.PROFILE_EMAIL : OtpPurpose.PROFILE_PHONE;

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
      this.logger.log(`[DEV] Profile phone OTP for user ${userId}: ${code}`);
    }
  }

  async verifyProfileOtp(userId: string, dto: ProfileOtpVerifyDto): Promise<UserResponseDto> {
    const purpose = dto.type === 'email' ? OtpPurpose.PROFILE_EMAIL : OtpPurpose.PROFILE_PHONE;
    const isDev = this.config.get<string>('app.nodeEnv') === 'development';
    const isDevBypass = isDev && dto.code === DEV_OTP_BYPASS;

    if (!isDevBypass) {
      const claim = await this.prisma.otpCode.updateMany({
        where: { userId, code: dto.code, purpose, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!claim.count)
        throw new BadRequestException({
          message: 'Invalid or expired OTP',
          errorCode: ERROR_CODES.BAD_REQUEST,
        });
    }

    if (dto.type === 'email') {
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
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getOrThrow(id: string): Promise<User & { organization?: Organization | null }> {
    const user = await this.prisma.client.user.findFirst({
      where: { id },
      include: { organization: true },
    });
    if (!user) throw new UserNotFoundException();
    return user;
  }
}
