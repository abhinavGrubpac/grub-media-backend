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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { Paginated } from '../../../common/dto/paginated';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

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
  list(@Query() query: UserQueryDto): Promise<Paginated<UserResponseDto>> {
    return this.users.list(query);
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
  async remove(@Param('id') id: string): Promise<null> {
    await this.users.softDelete(id);
    return null;
  }
}
