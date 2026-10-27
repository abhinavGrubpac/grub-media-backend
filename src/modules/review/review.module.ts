import { Module } from '@nestjs/common';
import { ReviewController } from './controllers/review.controller';
import { ExportService } from './services/export.service';
import { CreativePdfService } from './services/creative-pdf.service';
import { CreativeService } from './services/review.service';
import { ActivityLogService } from '../../common/activity-log/activity-log.service';
import { StorageService } from '../../common/storage/storage.service';
import { AdvertModule } from '../advert/advert.module';

@Module({
  imports: [AdvertModule],
  controllers: [ReviewController],
  providers: [
    CreativeService,
    ExportService,
    CreativePdfService,
    ActivityLogService,
    StorageService,
  ],
  exports: [CreativeService],
})
export class ReviewModule {}
