import { ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
export class UpdateBundleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMinSize(1) permissionIds?: string[];
}
export class ReassignBundleDto {
  @IsArray() @IsString({ each: true }) @ArrayMinSize(1) userIds!: string[];
  @IsString() targetBundleId!: string;
}
