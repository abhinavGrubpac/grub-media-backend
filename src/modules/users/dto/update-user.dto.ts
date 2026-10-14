import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * Updatable fields: everything on CreateUserDto except password (password
 * changes go through a dedicated flow). Status transitions (suspend /
 * activate / dismiss) use their own dedicated endpoints.
 */
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {}
