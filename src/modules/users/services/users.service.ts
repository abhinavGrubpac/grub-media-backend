import { Optional, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import { UserStatus, LogType, type User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { describeActor, logRefOf } from '../../../common/utils/log-ref';
import { StorageService } from '../../storage/storage.service';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import {
  EmailAlreadyExistsException,
  UserNotFoundException,
} from '../../../common/exceptions/domain.exceptions';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto, USER_SORTABLE_FIELDS, UserSortField } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { ProfileUpdateDto } from '../dto/profile-update.dto';
import { LogsService } from '../../logs/services/logs.service';

/** Log taxonomy names for user management events (Log System EMPLOYEE stream). */
const LOG_CATEGORY = {
  onboarding: 'Onboarding',
  employment: 'Employment',
  exit: 'Exit',
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
    // Optional only so unit specs can construct the service without S3 —
    // the global StorageModule always provides it in the running app.
    @Optional() private readonly storage?: StorageService,
  ) {}

  private toDto(user: User): UserResponseDto {
    return plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });
  }

  async create(dto: CreateUserDto, actorId?: string): Promise<UserResponseDto> {
    const existing = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (existing) {
      throw new EmailAlreadyExistsException();
    }
    // If the admin doesn't supply a password, generate a secure random one —
    // the employee sets their own via "forgot password" before first login.
    const rawPassword = dto.password ?? randomBytes(16).toString('base64url');
    const passwordHash = await argon2.hash(rawPassword, { type: argon2.argon2id });
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
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.onboarding,
      actionName: 'Create Employee',
      actionText: `Employee ${user.email} was created by ${await describeActor(this.prisma, actorId)}`,
      userId: actorId,
      empId: user.id,
      target: logRefOf(user),
      newDetail: this.toDto(user),
    });
    return this.toDto(user);
  }

  /** Replace the user's avatar image in object storage (org-era upload flow). */
  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<UserResponseDto> {
    const user = await this.getOrThrow(userId);

    // Best-effort removal of the old object — never block the new upload.
    if (user.avatarUrl) {
      void this.storage?.deleteByUrl(user.avatarUrl);
    }

    const avatarUrl = await this.storage!.uploadImage('avatars', userId, file);
    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    await this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'Upload Avatar',
      actionText: `The avatar of ${user.email} was uploaded`,
      userId,
      empId: user.id,
      target: logRefOf(user),
      oldDetail: { avatarUrl: user.avatarUrl },
      newDetail: { avatarUrl: updated.avatarUrl },
    });
    return this.toDto(updated);
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
    const user = await this.prisma.client.user.update({ where: { id }, data: dto });
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
        // Status transitions have their own dedicated endpoints — never
        // updatable through the generic update DTO.
        updatedBy: actorId,
      },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.employment,
      actionName: 'Update Employee',
      actionText: `Employee ${user.email} was updated by ${await describeActor(this.prisma, actorId)}`,
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
      actionText: `The status of ${user.email} was changed from ${before.status.toLowerCase()} to ${status.toLowerCase()} by ${await describeActor(this.prisma, actorId)}`,
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
    const deletedAt = new Date();
    await this.prisma.client.user.update({ where: { id }, data: { deletedAt } });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.exit,
      actionName: 'Delete Employee',
      actionText: `Employee ${before.email} was deleted by ${await describeActor(this.prisma, actorId)}`,
      userId: actorId,
      empId: before.id,
      target: logRefOf(before),
      oldDetail: this.toDto(before),
      // A soft delete keeps the row, so the after state is the same record
      // carrying its deletion timestamp (ISO string: JSON-safe for details).
      newDetail: { ...this.toDto(before), deletedAt: deletedAt.toISOString() },
    });
  }

  async bulkActivate(ids: string[], actorId?: string): Promise<number> {
    const result = await this.prisma.client.user.updateMany({
      where: { id: { in: ids }, status: UserStatus.SUSPENDED, deletedAt: null },
      data: { status: UserStatus.ACTIVE },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY.employment,
      actionName: 'Bulk Activate',
      actionText: `${result.count} ${result.count === 1 ? 'employee was' : 'employees were'} reactivated by ${await describeActor(this.prisma, actorId)}`,
      userId: actorId,
      target: ids.join(','),
      oldDetail: { ids, fromStatus: UserStatus.SUSPENDED },
      newDetail: { ids, activated: result.count },
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
