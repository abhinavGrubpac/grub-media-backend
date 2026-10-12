import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { UsersController } from './controllers/users.controller';
import { AccessController } from './controllers/access.controller';
import { AccessService } from './services/access.service';

@Module({
  controllers: [UsersController, AccessController],
  providers: [UsersService, AccessService],
  exports: [UsersService],
})
export class UsersModule {}
