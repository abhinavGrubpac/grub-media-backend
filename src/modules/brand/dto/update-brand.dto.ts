import { PartialType } from '@nestjs/swagger';
import { CreateBrandDto } from './create-brand.dto';

/**
 * Brand identity renames/categories travel upstream (agency-owned); the
 * government PATCH path is for the compliance overlay and contact metadata.
 */
export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
