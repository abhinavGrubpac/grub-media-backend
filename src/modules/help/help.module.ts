import { Module } from '@nestjs/common';
import { HelpController } from './controllers/help.controller';
import { HelpService } from './services/help.service';

@Module({
  controllers: [HelpController],
  providers: [HelpService],
})
export class HelpModule {}
