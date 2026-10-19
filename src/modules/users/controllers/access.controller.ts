import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { AccessService } from '../services/access.service';
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
  constructor(private readonly access: AccessService) {}
  @Get('permissions') permissions() {
    return this.access.permissions();
  }
  @Post('permissions') permission(@Body() dto: PermissionDto) {
    return this.access.createPermission(dto);
  }
  @Get('bundles') bundles() {
    return this.access.bundles();
  }
  @Post('bundles') bundle(@CurrentUser() u: AuthUser, @Body() dto: BundleDto) {
    return this.access.createBundle(u.id, dto);
  }

  @Get('bundles/:id/users')
  bundleUsers(@Param('id') id: string) {
    return this.access.bundleUsers(id);
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
    return this.access.reassignBundle(u.id, u.role, fromBundleId, dto);
  }
  @Post('employees/:employeeId/bundles') assign(
    @CurrentUser() u: AuthUser,
    @Param('employeeId') e: string,
    @Body() dto: AssignBundleDto,
  ) {
    return this.access.assignBundle(u.id, e, dto.bundleId);
  }
  @Delete('employees/:employeeId/bundles/:bundleId') remove(
    @Param('employeeId') e: string,
    @Param('bundleId') b: string,
  ) {
    return this.access.removeBundle(e, b);
  }
  @Put('employees/:employeeId/admin') assignAdmin(
    @CurrentUser() u: AuthUser,
    @Param('employeeId') e: string,
    @Body() dto: AssignAdminDto,
  ) {
    return this.access.assignAdmin(u.id, e, dto.adminId);
  }
  @Delete('employees/:employeeId/admin') unassign(@Param('employeeId') e: string) {
    return this.access.unassignAdmin(e);
  }
  @Get('assignments') assignments() {
    return this.access.assignments();
  }
}
