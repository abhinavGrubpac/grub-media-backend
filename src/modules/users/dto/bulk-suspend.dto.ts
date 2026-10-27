import { IsArray, IsString, ArrayMinSize } from 'class-validator';
export class BulkSuspendDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}
