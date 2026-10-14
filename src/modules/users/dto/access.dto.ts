import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class PermissionDto {
  @IsString() @MinLength(1) module!: string;
  @IsString() @MinLength(1) page!: string;
  @IsString() @MinLength(1) action!: string;
}
export class BundleDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() @IsString({ each: true }) permissionIds!: string[];
}
export class AssignBundleDto {
  @IsString() bundleId!: string;
}
export class AssignAdminDto {
  @IsString() adminId!: string;
}
