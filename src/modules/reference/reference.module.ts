import { Module } from '@nestjs/common';
import { ReferenceController } from './controllers/reference.controller';
import { ReferenceService } from './services/reference.service';
import { StorageService } from './services/storage.service';

@Module({
  controllers: [ReferenceController],
  providers: [ReferenceService, StorageService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
