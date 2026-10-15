import { Module } from '@nestjs/common';
import { ActivityLogService } from '../../common/activity-log/activity-log.service';
import { UpstreamAttributionInterceptor } from '../../common/interceptors/upstream-attribution.interceptor';
import { AdvertModule } from '../advert/advert.module';
import { ReviewModule } from '../review/review.module';
import { TestIntakeController } from './controllers/test-intake.controller';
import { TestIntakeService } from './services/test-intake.service';

/**
 * TEMPORARY test-only intake (see TestIntakeService). Not wired in
 * production builds; deleted when the monorepo intake replaces it.
 */
@Module({
  imports: [AdvertModule, ReviewModule],
  controllers: [TestIntakeController],
  providers: [TestIntakeService, ActivityLogService, UpstreamAttributionInterceptor],
})
export class IntakeModule {}
