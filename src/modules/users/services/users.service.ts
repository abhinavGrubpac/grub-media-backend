import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import type { User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import {
  EmailAlreadyExistsException,
  UserNotFoundException,
} from '../../../common/exceptions/domain.exceptions';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async list(query: UserQueryDto): Promise<Paginated<UserResponseDto>> {
    const where = { role: query.role, status: query.status };
    const { skip, take } = toSkipTake(query);
    const orderBy = { [query.sortBy ?? 'createdAt']: query.sortOrder };
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
    const user = await this.prisma.client.user.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
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

  private async getOrThrow(id: string): Promise<User> {
    const user = await this.prisma.client.user.findFirst({ where: { id } });
    if (!user) {
      throw new UserNotFoundException();
    }
    return user;
  }
}
