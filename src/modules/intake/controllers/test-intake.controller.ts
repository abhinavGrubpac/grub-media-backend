import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { UpstreamAttributionInterceptor } from '../../../common/interceptors/upstream-attribution.interceptor';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import {
  BootstrapTestFlowDto,
  CreateTestBrandDto,
  CreateTestCreativeDto,
  RegisterAgencyDto,
  ScheduleTestAdvertDto,
} from '../dto/test-intake.dto';
import { TestIntakeService } from '../services/test-intake.service';

/**
 * TEMPORARY test stand-in for the agency/admin portal intake. Every route
 * is blocked in production and the module is deleted once the three-portal
 * monorepo intake lands. No government controller may depend on it.
 */
@ApiTags('test-intake')
@ApiBearerAuth()
@UseInterceptors(UpstreamAttributionInterceptor)
@Controller({ path: 'intake/test', version: '1' })
export class TestIntakeController {
  constructor(private readonly intakeService: TestIntakeService) {}

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('agencies')
  @ResponseMessage('Test agency registered')
  registerAgency(@Body() dto: RegisterAgencyDto) {
    return this.intakeService.registerAgency(dto);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('brands')
  @ResponseMessage('Test brand created')
  createBrand(@Body() dto: CreateTestBrandDto) {
    return this.intakeService.createBrand(dto);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('creatives')
  @ResponseMessage('Test creative created')
  createCreative(@Body() dto: CreateTestCreativeDto, @CurrentUser() user: AuthUser) {
    return this.intakeService.createCreative(dto, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('schedule')
  @ResponseMessage('Test advert scheduled')
  scheduleAdvert(@Body() dto: ScheduleTestAdvertDto, @CurrentUser() user: AuthUser) {
    return this.intakeService.scheduleAdvert(dto, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('bootstrap')
  @ResponseMessage('Test flow bootstrapped')
  bootstrap(@Body() dto: BootstrapTestFlowDto, @CurrentUser() user: AuthUser) {
    return this.intakeService.bootstrap(dto, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('go-live-sync')
  @ResponseMessage('Due schedules synced')
  goLiveSync(@CurrentUser() user: AuthUser) {
    return this.intakeService.goLiveSync(user.id);
  }
}
