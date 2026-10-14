import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import { UserStatus, LogType, type User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { logRefOf } from '../../../common/utils/log-ref';
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
    const user = await this.prisma.client.user.update({ where: { id }, data: dto });
    await this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'Update Profile',
      actionText: `Profile details updated for ${user.email}`,
      userId: id,
      empId: user.id,
      referenceId: logRefOf(user),
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
      referenceId: logRefOf(user),
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
      referenceId: logRefOf(user),
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
      referenceId: logRefOf(before),
      oldDetail: this.toDto(before),
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
      actionText: `${result.count} employee(s) reactivated by ${actorId ?? 'system'}`,
      userId: actorId,
      referenceId: ids.join(','),
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
