import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { LogType, UserRole } from '@prisma/client';
import { BundleDto, PermissionDto } from '../dto/access.dto';
import { LogsService } from '../../logs/services/logs.service';
import { logRefOf } from '../../../common/utils/log-ref';

/** Log taxonomy for access-management events (Log System EMPLOYEE stream). */
const LOG_CATEGORY = 'Access Management';

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
  ) {}
  permissions() {
    return this.prisma.client.permission.findMany({
      orderBy: [{ module: 'asc' }, { page: 'asc' }, { action: 'asc' }],
    });
  }
  async createPermission(actorId: string, dto: PermissionDto) {
    const permission = await this.prisma.client.permission.upsert({
      where: { module_page_action: dto },
      update: {},
      create: { ...dto, custom: true },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Create Permission',
      actionText: `Permission ${dto.module}.${dto.page}.${dto.action} created by ${actorId}`,
      userId: actorId,
      target: String(permission.id),
      newDetail: { module: dto.module, page: dto.page, action: dto.action },
    });
    return permission;
  }
  bundles() {
    return this.prisma.client.permissionBundle.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }
  async createBundle(actorId: string, dto: BundleDto) {
    const bundle = await this.prisma.client.permissionBundle.create({
      data: {
        name: dto.name,
        description: dto.description,
        createdBy: actorId,
        permissions: { create: dto.permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Create Bundle',
      actionText: `Permission bundle "${bundle.name}" created by ${actorId}`,
      userId: actorId,
      target: String(bundle.id),
      newDetail: { name: bundle.name, permissionCount: bundle.permissions.length },
    });
    return bundle;
  }
  async assignBundle(actor: string, employeeId: string, bundleId: string) {
    const row = await this.prisma.client.userBundle.upsert({
      where: { userId_bundleId: { userId: employeeId, bundleId } },
      update: { assignedBy: actor },
      create: { userId: employeeId, bundleId, assignedBy: actor },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Assign Bundle',
      actionText: `Permission bundle ${bundleId} assigned to employee ${employeeId} by ${actor}`,
      userId: actor,
      empId: employeeId,
      target: bundleId,
    });
    return row;
  }
  async removeBundle(actor: string, employeeId: string, bundleId: string) {
    const row = await this.prisma.client.userBundle.delete({
      where: { userId_bundleId: { userId: employeeId, bundleId } },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Remove Bundle',
      actionText: `Permission bundle ${bundleId} removed from employee ${employeeId} by ${actor}`,
      userId: actor,
      empId: employeeId,
      target: bundleId,
    });
    return row;
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
    const row = await this.prisma.client.adminEmployeeAssignment.upsert({
      where: { employeeId },
      update: { adminId, assignedBy: actor },
      create: { employeeId, adminId, assignedBy: actor },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Assign Admin',
      actionText: `Admin ${admin.email} assigned to employee ${employee.email} by ${actor}`,
      userId: actor,
      empId: employeeId,
      target: logRefOf(admin),
    });
    return row;
  }
  async unassignAdmin(actor: string, employeeId: string) {
    const row = await this.prisma.client.adminEmployeeAssignment.delete({
      where: { employeeId },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Unassign Admin',
      actionText: `Admin assignment removed from employee ${employeeId} by ${actor}`,
      userId: actor,
      empId: employeeId,
    });
    return row;
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
