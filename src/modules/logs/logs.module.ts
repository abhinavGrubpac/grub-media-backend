import { Global, Module } from '@nestjs/common';
import { LogsController } from './controllers/logs.controller';
import { LogsService } from './services/logs.service';

/**
 * @Global — every module can inject LogsService (mainly for `record()`)
 * without listing LogsModule in its imports. It is registered once in
 * AppModule, which is what Nest requires for a global module.
 */
@Global()
@Module({
  controllers: [LogsController],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
