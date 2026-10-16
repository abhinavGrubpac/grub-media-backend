import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, LogType } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { AccessService } from '../services/access.service';
import { LogsService } from '../../logs/services/logs.service';
import {
  AssignAdminDto,
  AssignBundleDto,
  BundleDto,
  PermissionDto,
  ReassignBundleDto,
  UpdateBundleDto,
} from '../dto/access.dto';
@ApiTags('Access Management')
@ApiBearerAuth()
@Controller({ path: 'access', version: '1' })
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly logs: LogsService,
  ) {}

  /** Read access into the log stream (EMPLOYEE / Access Management). */
  private logView(u: AuthUser, actionName: string, actionText: string): Promise<void> {
    return this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Access Management',
      actionName,
      actionText,
      userId: u.id,
    });
  }

  @Get('permissions')
  async permissions(@CurrentUser() u: AuthUser) {
    const rows = await this.access.permissions();
    await this.logView(u, 'View Permissions', 'Viewed permission catalog');
    return rows;
  }
  @Post('permissions') permission(@CurrentUser() u: AuthUser, @Body() dto: PermissionDto) {
    return this.access.createPermission(u.id, dto);
  }
  @Get('bundles')
  async bundles(@CurrentUser() u: AuthUser) {
    const rows = await this.access.bundles();
    await this.logView(u, 'View Bundles', 'Viewed permission bundles');
    return rows;
  }
  @Post('bundles') bundle(@CurrentUser() u: AuthUser, @Body() dto: BundleDto) {
    return this.access.createBundle(u.id, dto);
  }

  @Get('bundles/:id/users')
  async bundleUsers(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const rows = await this.access.bundleUsers(id);
    await this.logView(u, 'View Bundle Users', `Viewed users in bundle ${id}`);
    return rows;
  }

  @Patch('bundles/:id')
  updateBundle(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateBundleDto) {
    return this.access.updateBundle(u.id, u.role, id, dto);
  }

  @Delete('bundles/:id')
  deleteBundle(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.access.deleteBundle(u.id, u.role, id);
  }

  @Post('bundles/:id/reassign')
  reassignBundle(
    @CurrentUser() u: AuthUser,
    @Param('id') fromBundleId: string,
    @Body() dto: ReassignBundleDto,
  ) {
    return this.access.reassignBundle(u.id, fromBundleId, dto);
  }
  @Post('employees/:employeeId/bundles') assign(
    @CurrentUser() u: AuthUser,
    @Param('employeeId') e: string,
    @Body() dto: AssignBundleDto,
  ) {
    return this.access.assignBundle(u.id, e, dto.bundleId);
  }
  @Delete('employees/:employeeId/bundles/:bundleId') remove(
    @CurrentUser() u: AuthUser,
    @Param('employeeId') e: string,
    @Param('bundleId') b: string,
  ) {
    return this.access.removeBundle(u.id, e, b);
  }
  @Put('employees/:employeeId/admin') assignAdmin(
    @CurrentUser() u: AuthUser,
    @Param('employeeId') e: string,
    @Body() dto: AssignAdminDto,
  ) {
    return this.access.assignAdmin(u.id, e, dto.adminId);
  }
  @Delete('employees/:employeeId/admin') unassign(
    @CurrentUser() u: AuthUser,
    @Param('employeeId') e: string,
  ) {
    return this.access.unassignAdmin(u.id, e);
  }
  @Get('assignments')
  async assignments(@CurrentUser() u: AuthUser) {
    const rows = await this.access.assignments();
    await this.logView(u, 'View Assignments', 'Viewed employee bundle assignments');
    return rows;
  }
}
