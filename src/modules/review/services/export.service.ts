import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { normalizeCreativeStatusFilter } from '../transitions';
import { buildCreativeWhere, currentVersionIdsForStatus } from './review.service';

export interface CreativeExportRow {
  id: string;
  name: string;
  brand: string;
  status: string;
  version: number;
  uploadedOn: Date | null;
}

/** Flat projection used by the CSV export (API_SPECIFICATION.md). */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportCreatives(filters: {
    status?: string;
    brand_id?: string;
    industry?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    actor_id?: string;
    ids?: string[];
  }): Promise<CreativeExportRow[]> {
    const status = normalizeCreativeStatusFilter(filters.status);
    const currentVersionIds = status
      ? await currentVersionIdsForStatus(this.prisma, status)
      : undefined;
    const where = buildCreativeWhere(filters, status ? { currentVersionIds } : {});
    const creatives = await this.prisma.client.creative.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        brand: true,
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });
    return creatives.map((creative) => ({
      id: creative.id,
      name: creative.creativeName,
      brand: creative.brand.brandName,
      status: creative.versions[0]?.status ?? 'NO_VERSION',
      version: creative.versions[0]?.versionNumber ?? 0,
      uploadedOn: creative.versions[0]?.createdAt ?? null,
    }));
  }
}
