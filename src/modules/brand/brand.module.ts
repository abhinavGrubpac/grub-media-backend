import { Module } from '@nestjs/common';
import { BrandController } from './controllers/brand.controller';
import { BrandService } from './services/brand.service';

@Module({
  controllers: [BrandController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
