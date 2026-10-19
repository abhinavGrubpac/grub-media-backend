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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { OrganizationsService } from '../services/organizations.service';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { OrgQueryDto } from '../dto/org-query.dto';
import { OrganizationResponseDto } from '../dto/organization-response.dto';
import { Paginated } from '../../../common/dto/paginated';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { ImageFileValidationPipe } from '../../../common/pipes/image-file-validation.pipe';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller({ path: 'organizations', version: '1' })
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  @Roles(UserRole.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Create an organisation (Super Admin only)' })
  @ResponseMessage('Organisation created')
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<OrganizationResponseDto> {
    return this.orgs.create(dto, actor.id);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'List organisations (paginated, Admin+)' })
  @ResponseMessage('Organisations fetched successfully')
  async list(@Query() query: OrgQueryDto): Promise<Paginated<OrganizationResponseDto>> {
    const page = await this.orgs.list(query);
    return page;
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Get an organisation by ID (Admin+)' })
  @ResponseMessage('Organisation fetched successfully')
  async findOne(@Param('id') id: string): Promise<OrganizationResponseDto> {
    const org = await this.orgs.findById(id);
    return org;
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update organisation details (Admin+)' })
  @ResponseMessage('Organisation updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<OrganizationResponseDto> {
    return this.orgs.update(id, dto, actor.id, actor.role);
  }

  // ---------------------------------------------------------------------------
  // Logo upload
  // ---------------------------------------------------------------------------

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post(':id/logo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload or replace organisation logo (Admin+)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'JPEG, PNG, or WebP — max 5 MB' },
      },
    },
  })
  @ResponseMessage('Logo uploaded successfully')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  uploadLogo(
    @Param('id') id: string,
    @UploadedFile(new ImageFileValidationPipe()) file: Express.Multer.File,
  ): Promise<OrganizationResponseDto> {
    return this.orgs.uploadLogo(id, file);
  }

  // ---------------------------------------------------------------------------
  // Status transitions — Super Admin only
  // ---------------------------------------------------------------------------

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an organisation (Super Admin only)' })
  @ResponseMessage('Organisation suspended')
  suspend(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<OrganizationResponseDto> {
    return this.orgs.suspend(id, actor.id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a suspended organisation (Super Admin only)' })
  @ResponseMessage('Organisation activated')
  activate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<OrganizationResponseDto> {
    return this.orgs.activate(id, actor.id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete an organisation (Super Admin only)' })
  @ResponseMessage('Organisation deleted')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<null> {
    await this.orgs.softDelete(id, actor.id);
    return null;
  }
}
