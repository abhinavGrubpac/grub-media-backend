import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, OrgStatus, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import { ERROR_CODES } from '../../../common/constants/error-codes';
import { OrgNotFoundException } from '../../../common/exceptions/domain.exceptions';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { OrganizationResponseDto } from '../dto/organization-response.dto';
import { OrgQueryDto } from '../dto/org-query.dto';

type OrgWithCount = Prisma.OrganizationGetPayload<{
  include: { _count: { select: { users: true } } };
}>;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private toDto(org: OrgWithCount): OrganizationResponseDto {
    return plainToInstance(
      OrganizationResponseDto,
      { ...org, userCount: org._count.users },
      { excludeExtraneousValues: true },
    );
  }

  private async getOrThrow(id: string): Promise<OrgWithCount> {
    const org = await this.prisma.client.organization.findFirst({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!org) throw new OrgNotFoundException();
    return org;
  }

  private handleUniqueViolation(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException({
        message: 'Registration number already in use',
        errorCode: ERROR_CODES.CONFLICT,
      });
    }
    throw e;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(dto: CreateOrganizationDto, actorId: string): Promise<OrganizationResponseDto> {
    try {
      const org = await this.prisma.client.organization.create({
        data: {
          name: dto.name,
          regNumber: dto.regNumber,
          logoUrl: dto.logoUrl,
          jurisdiction: dto.jurisdiction,
          createdBy: actorId,
        },
        include: { _count: { select: { users: true } } },
      });
      return this.toDto(org);
    } catch (e) {
      this.handleUniqueViolation(e);
    }
  }

  async list(query: OrgQueryDto): Promise<Paginated<OrganizationResponseDto>> {
    const { skip, take } = toSkipTake(query);

    const searchWhere: Prisma.OrganizationWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { regNumber: { contains: query.search, mode: 'insensitive' } },
            { jurisdiction: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const where: Prisma.OrganizationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...searchWhere,
    };

    const [orgs, total] = await Promise.all([
      this.prisma.client.organization.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true } } },
      }),
      this.prisma.client.organization.count({ where }),
    ]);

    return {
      data: orgs.map((o) => this.toDto(o)),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  async findById(id: string): Promise<OrganizationResponseDto> {
    return this.toDto(await this.getOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
    actorId: string,
    actorRole: UserRole,
  ): Promise<OrganizationResponseDto> {
    const org = await this.getOrThrow(id);

    if (org.status === OrgStatus.SUSPENDED && actorRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({
        message: 'Only a Super Admin can edit a suspended organisation',
        errorCode: ERROR_CODES.FORBIDDEN,
      });
    }

    try {
      const updated = await this.prisma.client.organization.update({
        where: { id },
        data: {
          name: dto.name,
          regNumber: dto.regNumber,
          logoUrl: dto.logoUrl,
          jurisdiction: dto.jurisdiction,
          updatedBy: actorId,
        },
        include: { _count: { select: { users: true } } },
      });
      return this.toDto(updated);
    } catch (e) {
      this.handleUniqueViolation(e);
    }
  }

  async uploadLogo(
    id: string,
    file: Express.Multer.File,
    _actorId: string,
  ): Promise<OrganizationResponseDto> {
    const org = await this.getOrThrow(id);

    if (org.logoUrl) {
      void this.storage.deleteByUrl(org.logoUrl);
    }

    const logoUrl = await this.storage.uploadImage('org-logos', id, file);
    const updated = await this.prisma.client.organization.update({
      where: { id },
      data: { logoUrl },
      include: { _count: { select: { users: true } } },
    });
    return this.toDto(updated);
  }

  // ---------------------------------------------------------------------------
  // Status transitions — SUPER_ADMIN only
  // ---------------------------------------------------------------------------

  async suspend(id: string, actorId: string): Promise<OrganizationResponseDto> {
    const org = await this.getOrThrow(id);

    if (org.status === OrgStatus.SUSPENDED) {
      throw new BadRequestException({
        message: 'Organisation is already suspended',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }

    const updated = await this.prisma.client.organization.update({
      where: { id },
      data: { status: OrgStatus.SUSPENDED, updatedBy: actorId },
      include: { _count: { select: { users: true } } },
    });
    return this.toDto(updated);
  }

  async activate(id: string, actorId: string): Promise<OrganizationResponseDto> {
    const org = await this.getOrThrow(id);

    if (org.status === OrgStatus.ACTIVE) {
      throw new BadRequestException({
        message: 'Organisation is already active',
        errorCode: ERROR_CODES.BAD_REQUEST,
      });
    }

    const updated = await this.prisma.client.organization.update({
      where: { id },
      data: { status: OrgStatus.ACTIVE, updatedBy: actorId },
      include: { _count: { select: { users: true } } },
    });
    return this.toDto(updated);
  }

  async softDelete(id: string, actorId: string): Promise<void> {
    await this.getOrThrow(id);

    await this.prisma.client.organization.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
  }
}
