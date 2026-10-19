import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [UsersModule, OrganizationsModule],
  controllers: [UploadController],
})
export class UploadModule {}
