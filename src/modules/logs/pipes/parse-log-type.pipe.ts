import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { LogType } from '@prisma/client';

const LOG_TYPE_VALUES = new Set<string>(Object.values(LogType));

/**
 * Validates and normalises the `:logtype` path param (GET /logs/:logtype).
 * Accepts the enum case-insensitively (`system` → SYSTEM) and rejects
 * anything else with a 400 listing the valid values — otherwise an unknown
 * value would silently return an empty page.
 */
export class ParseLogTypePipe implements PipeTransform<string, LogType> {
  transform(value: string, _metadata: ArgumentMetadata): LogType {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : value;
    if (!LOG_TYPE_VALUES.has(normalized)) {
      throw new BadRequestException(`logtype must be one of: ${Object.values(LogType).join(', ')}`);
    }
    return normalized as LogType;
  }
}
