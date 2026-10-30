import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { ExportUsersDto } from '../dto/export-users.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { ProfileUpdateDto } from '../dto/profile-update.dto';
import { BulkActivateDto } from '../dto/bulk-activate.dto';
import { Paginated } from '../../../common/dto/paginated';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { ProfileOtpRequestDto } from '../../auth/dto/profile-otp-request.dto';
import { ProfileOtpVerifyDto } from '../../auth/dto/profile-otp-verify.dto';
import { ChangePasswordDto } from '../../auth/dto/change-password.dto';
import { SetPasswordDto } from '../../auth/dto/set-password.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ---------------------------------------------------------------------------
  // Self-service profile
  // ---------------------------------------------------------------------------

  @Get('profile')
  @ApiOperation({ summary: 'Get the current user profile' })
  @ResponseMessage('Profile fetched successfully')
  profile(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    return this.users.findById(user.id);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update editable profile fields (name, logo, jurisdiction)' })
  @ResponseMessage('Profile updated successfully')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: ProfileUpdateDto,
  ): Promise<UserResponseDto> {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('profile/otp-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an OTP to verify a new email or phone number' })
  @ResponseMessage('OTP sent to your new contact')
  async requestProfileOtp(
    @CurrentUser() user: AuthUser,
    @Body() dto: ProfileOtpRequestDto,
  ): Promise<null> {
    await this.users.requestProfileOtp(user.id, dto);
    return null;
  }

  @Post('profile/otp-verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and apply the new email or phone number' })
  @ResponseMessage('Contact updated successfully')
  verifyProfileOtp(
    @CurrentUser() user: AuthUser,
    @Body() dto: ProfileOtpVerifyDto,
  ): Promise<UserResponseDto> {
    return this.users.verifyProfileOtp(user.id, dto);
  }

  @Post('profile/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password (requires current password)' })
  @ResponseMessage('Password changed successfully')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<null> {
    await this.users.changePassword(user.id, dto);
    return null;
  }

  @Post('profile/set-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or replace password without requiring the current one',
    description:
      'Intended for users who authenticated via OTP and have no password yet, or need to set a new one without knowing the old one. Invalidates all other active sessions.',
  })
  @ResponseMessage('Password set successfully')
  async setPassword(@CurrentUser() user: AuthUser, @Body() dto: SetPasswordDto): Promise<null> {
    await this.users.setPassword(user.id, dto);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.create')
  @Post()
  @ApiOperation({ summary: 'Create a user (admin only)' })
  @ResponseMessage('User created')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser): Promise<UserResponseDto> {
    return this.users.create(dto, actor.id, actor.role);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.read')
  @Get()
  @ApiOperation({ summary: 'List users (paginated, admin only)' })
  @ResponseMessage('Users fetched successfully')
  list(
    @Query() query: UserQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<Paginated<UserResponseDto>> {
    return this.users.list(query, actor.role);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.read')
  @Post('export/csv')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export users as CSV (all / active / suspended / dismissed / selected IDs)',
  })
  async exportCsv(@Body() dto: ExportUsersDto, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(await this.users.exportCsv(dto));
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.update')
  @Put('bulk-activate')
  @ApiOperation({ summary: 'Bulk-activate suspended or inactive users' })
  @ResponseMessage('Users activated')
  async bulkActivate(@Body() dto: BulkActivateDto): Promise<{ activated: number }> {
    return { activated: await this.users.bulkActivate(dto.ids) };
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.read')
  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id (admin only)' })
  @ResponseMessage('User fetched successfully')
  findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.users.findById(id);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.update')
  @Patch(':id')
  @ApiOperation({ summary: 'Update user name or role (admin only)' })
  @ResponseMessage('User updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<UserResponseDto> {
    return this.users.update(id, dto, actor.id, actor.role);
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.update')
  @Patch(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a user account (blocks login, reversible)' })
  @ResponseMessage('User suspended')
  suspend(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<UserResponseDto> {
    return this.users.suspend(id, actor.id, actor.role);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.update')
  @Patch(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a suspended or inactive user to active' })
  @ResponseMessage('User activated')
  activate(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<UserResponseDto> {
    return this.users.activate(id, actor.id, actor.role);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.update')
  @Patch(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss a user (set inactive — account persists, login blocked)' })
  @ResponseMessage('User dismissed')
  dismiss(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<UserResponseDto> {
    return this.users.dismiss(id, actor.id, actor.role);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.delete')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a user (permanent removal from listings)' })
  @ResponseMessage('User deleted')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<null> {
    await this.users.softDelete(id, actor.id, actor.role);
    return null;
  }
}
