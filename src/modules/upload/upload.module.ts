import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [UsersModule],
  controllers: [UploadController],
})
export class UploadModule {}
