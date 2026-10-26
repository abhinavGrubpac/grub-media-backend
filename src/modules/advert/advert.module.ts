import { Module } from '@nestjs/common';
import { ActivityLogService } from '../../common/activity-log/activity-log.service';
import { AdvertController } from './controllers/advert.controller';
import { Geocoder } from './services/geocoder';
import { AdvertService } from './services/advert.service';

@Module({
  controllers: [AdvertController],
  providers: [AdvertService, ActivityLogService, Geocoder],
  exports: [AdvertService],
})
export class AdvertModule {}
