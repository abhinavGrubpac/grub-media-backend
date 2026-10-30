import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { UserRole } from '@prisma/client';
import { BundleDto, PermissionDto, ReassignBundleDto, UpdateBundleDto } from '../dto/access.dto';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertNotSelfBundle(
    actorId: string,
    actorRole: UserRole,
    bundleId: string,
  ): Promise<void> {
    if (actorRole === UserRole.SUPER_ADMIN) return;
    const selfAssignment = await this.prisma.client.userBundle.findUnique({
      where: { userId_bundleId: { userId: actorId, bundleId } },
    });
    if (selfAssignment) {
      throw new ForbiddenException('Cannot modify a bundle you are currently assigned to');
    }
  }

  permissions() {
    return this.prisma.client.permission.findMany({
      orderBy: [{ module: 'asc' }, { page: 'asc' }, { action: 'asc' }],
    });
  }
  createPermission(dto: PermissionDto) {
    return this.prisma.client.permission.upsert({
      where: { module_page_action: dto },
      update: {},
      create: { ...dto, custom: true },
    });
  }
  bundles() {
    return this.prisma.client.permissionBundle.findMany({
      include: {
        permissions: { include: { permission: true } },
        users: {
          where: { user: { deletedAt: null } },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNumber: true,
                employeeId: true,
                jurisdiction: true,
                joiningDate: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  bundleUsers(bundleId: string) {
    return this.prisma.client.userBundle.findMany({
      where: {
        bundleId,
        user: { deletedAt: null },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            employeeId: true,
            jurisdiction: true,
            joiningDate: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
  async createBundle(actorId: string, dto: BundleDto) {
    return this.prisma.client.permissionBundle.create({
      data: {
        name: dto.name,
        description: dto.description,
        createdBy: actorId,
        permissions: { create: dto.permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
  }
  async updateBundle(actorId: string, actorRole: UserRole, bundleId: string, dto: UpdateBundleDto) {
    await this.assertNotSelfBundle(actorId, actorRole, bundleId);
    const existing = await this.prisma.client.permissionBundle.findUnique({
      where: { id: bundleId },
    });
    if (!existing) throw new NotFoundException('Bundle not found');

    const bundle = await this.prisma.client.permissionBundle.update({
      where: { id: bundleId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.permissionIds
          ? {
              permissions: {
                deleteMany: {},
                create: dto.permissionIds.map((permissionId) => ({ permissionId })),
              },
            }
          : {}),
      },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });

    return { bundle, affectedUserCount: bundle._count.users };
  }

  async deleteBundle(actorId: string, actorRole: UserRole, bundleId: string) {
    await this.assertNotSelfBundle(actorId, actorRole, bundleId);
    const existing = await this.prisma.client.permissionBundle.findUnique({
      where: { id: bundleId },
      include: { _count: { select: { users: true } } },
    });
    if (!existing) throw new NotFoundException('Bundle not found');
    const affectedUserCount = existing._count.users;

    await this.prisma.client.permissionBundle.delete({ where: { id: bundleId } });

    return { id: bundleId, name: existing.name, affectedUserCount };
  }

  async reassignBundle(
    actorId: string,
    actorRole: UserRole,
    fromBundleId: string,
    dto: ReassignBundleDto,
  ) {
    if (actorRole !== UserRole.SUPER_ADMIN && dto.userIds.includes(actorId)) {
      throw new ForbiddenException('Cannot reassign yourself to a different bundle');
    }

    const [fromBundle, targetBundle] = await Promise.all([
      this.prisma.client.permissionBundle.findUnique({
        where: { id: fromBundleId },
        select: { name: true },
      }),
      this.prisma.client.permissionBundle.findUnique({
        where: { id: dto.targetBundleId },
        select: { name: true },
      }),
    ]);
    if (!fromBundle) throw new NotFoundException('Source bundle not found');
    if (!targetBundle) throw new NotFoundException('Target bundle not found');

    const validAssignments = await this.prisma.client.userBundle.findMany({
      where: { bundleId: fromBundleId, userId: { in: dto.userIds } },
      select: { userId: true },
    });
    if (validAssignments.length === 0) {
      throw new BadRequestException(
        'None of the specified users are assigned to the source bundle',
      );
    }
    const validUserIds = validAssignments.map((a) => a.userId);

    const { deleted } = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.userBundle.deleteMany({
        where: { bundleId: fromBundleId, userId: { in: validUserIds } },
      });
      await tx.userBundle.createMany({
        data: validUserIds.map((userId) => ({
          userId,
          bundleId: dto.targetBundleId,
          assignedBy: actorId,
        })),
        skipDuplicates: true,
      });
      return { deleted };
    });

    return { reassigned: deleted.count, fromBundleId, targetBundleId: dto.targetBundleId };
  }

  assignBundle(actor: string, employeeId: string, bundleId: string) {
    return this.prisma.client.userBundle.upsert({
      where: { userId_bundleId: { userId: employeeId, bundleId } },
      update: { assignedBy: actor },
      create: { userId: employeeId, bundleId, assignedBy: actor },
    });
  }
  removeBundle(employeeId: string, bundleId: string) {
    return this.prisma.client.userBundle.delete({
      where: { userId_bundleId: { userId: employeeId, bundleId } },
    });
  }
  async assignAdmin(actor: string, employeeId: string, adminId: string) {
    const [employee, admin] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: employeeId } }),
      this.prisma.client.user.findUnique({ where: { id: adminId } }),
    ]);
    if (
      !employee ||
      employee.role !== UserRole.EMPLOYEE ||
      !admin ||
      (admin.role !== UserRole.ADMIN && admin.role !== UserRole.SUPER_ADMIN)
    )
      throw new NotFoundException('Employee or admin not found');
    return this.prisma.client.adminEmployeeAssignment.upsert({
      where: { employeeId },
      update: { adminId, assignedBy: actor },
      create: { employeeId, adminId, assignedBy: actor },
    });
  }
  unassignAdmin(employeeId: string) {
    return this.prisma.client.adminEmployeeAssignment.delete({ where: { employeeId } });
  }
  assignments() {
    return this.prisma.client.adminEmployeeAssignment.findMany({
      include: {
        admin: { select: { id: true, email: true, firstName: true, lastName: true } },
        employee: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }
}
