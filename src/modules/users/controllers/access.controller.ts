import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { AccessService } from '../services/access.service';
import { AssignAdminDto, AssignBundleDto, BundleDto, PermissionDto } from '../dto/access.dto';
@ApiTags('Access Management')
@ApiBearerAuth()
@Controller({ path: 'access', version: '1' })
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AccessController {
  constructor(private readonly access: AccessService) {}
  @Get('permissions') permissions() {
    return this.access.permissions();
  }
  @Post('permissions') permission(@CurrentUser() u: AuthUser, @Body() dto: PermissionDto) {
    return this.access.createPermission(u.id, dto);
  }
  @Get('bundles') bundles() {
    return this.access.bundles();
  }
  @Post('bundles') bundle(@CurrentUser() u: AuthUser, @Body() dto: BundleDto) {
    return this.access.createBundle(u.id, dto);
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
  @Get('assignments') assignments() {
    return this.access.assignments();
  }
}
