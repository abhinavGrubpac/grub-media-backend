import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { LogType, UserRole } from '@prisma/client';
import { BundleDto, PermissionDto } from '../dto/access.dto';
import { LogsService } from '../../logs/services/logs.service';
import { describeActor, logRefOf } from '../../../common/utils/log-ref';

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
      actionText: `The permission ${dto.module}.${dto.page}.${dto.action} was added by ${await describeActor(this.prisma, actorId)}`,
      userId: actorId,
      target: String(permission.id),
      newDetail: { module: dto.module, page: dto.page, action: dto.action },
    });
    return permission;
  }
  bundles() {
    return this.prisma.client.permissionBundle.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
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
          },
        },
      },
      orderBy: { createdAt: 'asc' },
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
      actionText: `The permission bundle "${bundle.name}" was created by ${await describeActor(this.prisma, actorId)}`,
      userId: actorId,
      target: String(bundle.id),
      newDetail: { name: bundle.name, permissionCount: bundle.permissions.length },
    });
    return bundle;
  }
  async assignBundle(actor: string, employeeId: string, bundleId: string) {
    // Pre-read the existing assignment so the audit row can carry the previous
    // state when this upsert reassigns rather than creates; resolve the names
    // in the same round so the audit sentence reads like English, not raw ids.
    const [previous, bundle, employee] = await Promise.all([
      this.prisma.client.userBundle.findUnique({
        where: { userId_bundleId: { userId: employeeId, bundleId } },
      }),
      this.prisma.client.permissionBundle.findUnique({
        where: { id: bundleId },
        select: { name: true },
      }),
      this.prisma.client.user.findUnique({
        where: { id: employeeId },
        select: { id: true, email: true, employeeId: true },
      }),
    ]);
    const row = await this.prisma.client.userBundle.upsert({
      where: { userId_bundleId: { userId: employeeId, bundleId } },
      update: { assignedBy: actor },
      create: { userId: employeeId, bundleId, assignedBy: actor },
    });
    const bundleName = bundle?.name ?? bundleId;
    const employeeRef = logRefOf(employee ?? { id: employeeId, email: null, employeeId: null });
    const by = await describeActor(this.prisma, actor);
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Assign Bundle',
      actionText: `The permission bundle "${bundleName}" was assigned to ${employeeRef} by ${by}`,
      userId: actor,
      empId: employeeId,
      target: bundleId,
      oldDetail: previous ?? undefined,
      newDetail: row,
    });
    return row;
  }
  async removeBundle(actor: string, employeeId: string, bundleId: string) {
    const row = await this.prisma.client.userBundle.delete({
      where: { userId_bundleId: { userId: employeeId, bundleId } },
    });
    const [bundle, employee] = await Promise.all([
      this.prisma.client.permissionBundle.findUnique({
        where: { id: bundleId },
        select: { name: true },
      }),
      this.prisma.client.user.findUnique({
        where: { id: employeeId },
        select: { id: true, email: true, employeeId: true },
      }),
    ]);
    const bundleName = bundle?.name ?? bundleId;
    const employeeRef = logRefOf(employee ?? { id: employeeId, email: null, employeeId: null });
    const by = await describeActor(this.prisma, actor);
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Remove Bundle',
      actionText: `The permission bundle "${bundleName}" was removed from ${employeeRef} by ${by}`,
      userId: actor,
      empId: employeeId,
      target: bundleId,
      // Before = the assignment that existed; after = the employee no longer
      // holds the bundle.
      oldDetail: row,
      newDetail: { userId: employeeId, bundleId, assigned: false },
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
    // Pre-read the current assignment so a replacement records who the previous
    // admin was (oldDetail) alongside the new one (newDetail).
    const previous = await this.prisma.client.adminEmployeeAssignment.findUnique({
      where: { employeeId },
    });
    const row = await this.prisma.client.adminEmployeeAssignment.upsert({
      where: { employeeId },
      update: { adminId, assignedBy: actor },
      create: { employeeId, adminId, assignedBy: actor },
    });
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Assign Admin',
      actionText: `The administrator ${logRefOf(admin)} was assigned to ${logRefOf(employee)} by ${await describeActor(this.prisma, actor)}`,
      userId: actor,
      empId: employeeId,
      target: logRefOf(admin),
      oldDetail: previous ?? undefined,
      newDetail: row,
    });
    return row;
  }
  async unassignAdmin(actor: string, employeeId: string) {
    const row = await this.prisma.client.adminEmployeeAssignment.delete({
      where: { employeeId },
    });
    const [employee, admin] = await Promise.all([
      this.prisma.client.user.findUnique({
        where: { id: employeeId },
        select: { id: true, email: true, employeeId: true },
      }),
      this.prisma.client.user.findUnique({
        where: { id: row.adminId },
        select: { id: true, email: true, employeeId: true },
      }),
    ]);
    const employeeRef = logRefOf(employee ?? { id: employeeId, email: null, employeeId: null });
    const adminRef = logRefOf(admin ?? { id: row.adminId, email: null, employeeId: null });
    const by = await describeActor(this.prisma, actor);
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: LOG_CATEGORY,
      actionName: 'Unassign Admin',
      actionText: `The administrator ${adminRef} was removed from ${employeeRef} by ${by}`,
      userId: actor,
      empId: employeeId,
      // Before = the assignment that existed; after = the employee no longer
      // has that administrator.
      oldDetail: row,
      newDetail: { employeeId, adminId: row.adminId, assigned: false },
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
