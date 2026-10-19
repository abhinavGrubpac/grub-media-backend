import { BadRequestException } from '@nestjs/common';

/**
 * WORKFLOWS.md §2.3 preventative: a deactivated (killed) brand accepts no
 * new creatives, versions, or advert schedules anywhere in the portal.
 */
export function assertBrandActive(isActive: boolean, brandId: string): void {
  if (isActive === false) {
    throw new BadRequestException(
      `Brand ${brandId} is deactivated (global kill-switch); operation blocked`,
    );
  }
}
