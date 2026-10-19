import { Module } from '@nestjs/common';
import { ActivityLogService } from '../../common/activity-log/activity-log.service';
import { AdvertController } from './controllers/advert.controller';
import { AdvertService } from './services/advert.service';

@Module({
  controllers: [AdvertController],
  providers: [AdvertService, ActivityLogService],
  exports: [AdvertService],
})
export class AdvertModule {}
