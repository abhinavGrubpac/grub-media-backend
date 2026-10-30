import { Module } from '@nestjs/common';
import { OrganizationsService } from './services/organizations.service';
import { OrganizationsController } from './controllers/organizations.controller';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
