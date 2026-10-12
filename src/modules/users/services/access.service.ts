import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { UserRole } from '@prisma/client';
import { BundleDto, PermissionDto } from '../dto/access.dto';
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}
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
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
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
