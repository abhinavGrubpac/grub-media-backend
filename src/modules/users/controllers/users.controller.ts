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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole, LogType } from '@prisma/client';
import { UsersService } from '../services/users.service';
import { LogsService } from '../../logs/services/logs.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { Paginated } from '../../../common/dto/paginated';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { ProfileUpdateDto } from '../dto/profile-update.dto';
import { BulkActivateDto } from '../dto/bulk-activate.dto';
import { Res } from '@nestjs/common';
import type { Response } from 'express';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly logs: LogsService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get the current user profile' })
  async profile(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    const profile = await this.users.findById(user.id);
    await this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'View Profile',
      actionText: 'Viewed their own profile',
      userId: user.id,
      target: user.id,
    });
    return profile;
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update editable profile fields' })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: ProfileUpdateDto,
  ): Promise<UserResponseDto> {
    return this.users.updateProfile(user.id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.create')
  @Post()
  @ApiOperation({ summary: 'Create a user (admin only)' })
  @ResponseMessage('User created')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser): Promise<UserResponseDto> {
    return this.users.create(dto, actor.id);
  }

  // User directory is admin-only — a regular user reads their own profile via
  // GET /auth/me. Self-service read/update of /users/:id is deferred (ADR note).
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.read')
  @Get()
  @ApiOperation({ summary: 'List users (paginated, admin only)' })
  @ResponseMessage('Users fetched successfully')
  async list(
    @Query() query: UserQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<Paginated<UserResponseDto>> {
    const result = await this.users.list(query);
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Employment',
      actionName: 'List Users',
      actionText: `Viewed the employee directory, page ${query.page}`,
      userId: actor.id,
    });
    return result;
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('export/csv')
  async exportCsv(
    @Query() query: UserQueryDto,
    @CurrentUser() actor: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.users.toCsv(query);
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Employment',
      actionName: 'Export Users',
      actionText: 'Downloaded the employee list as a CSV file',
      userId: actor.id,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Put('bulk-activate')
  async bulkActivate(
    @Body() dto: BulkActivateDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<{ activated: number }> {
    return { activated: await this.users.bulkActivate(dto.ids, actor.id) };
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.read')
  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id (admin only)' })
  @ResponseMessage('User fetched successfully')
  async findOne(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<UserResponseDto> {
    const user = await this.users.findById(id);
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Employment',
      actionName: 'View User',
      actionText: `Viewed the profile of ${user.email}`,
      userId: actor.id,
      target: id,
    });
    return user;
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.update')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a user (admin only)' })
  @ResponseMessage('User updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<UserResponseDto> {
    return this.users.update(id, dto, actor.id);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions('users.delete')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a user (admin only)' })
  @ResponseMessage('User deleted')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<null> {
    await this.users.softDelete(id, actor.id);
    return null;
  }
}
