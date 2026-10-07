import { Injectable } from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

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
    status?: ReviewStatus;
    brand_id?: string;
  }): Promise<CreativeExportRow[]> {
    const where: Prisma.CreativeWhereInput = {
      ...(filters.brand_id ? { brandId: filters.brand_id } : {}),
      ...(filters.status ? { versions: { some: { status: filters.status } } } : {}),
    };
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
