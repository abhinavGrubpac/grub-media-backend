import { Module } from '@nestjs/common';
import { ReviewController } from './controllers/review.controller';
import { ExportService } from './services/export.service';
import { CreativeService } from './services/review.service';

@Module({
  controllers: [ReviewController],
  providers: [CreativeService, ExportService],
  exports: [CreativeService],
})
export class ReviewModule {}
