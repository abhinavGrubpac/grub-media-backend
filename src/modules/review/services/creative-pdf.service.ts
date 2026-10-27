import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { StorageService } from '../../../common/storage/storage.service';
import type { CreativeExportRow, CreativeExportVersionRow } from './export.service';

const PAGE_MARGIN = 40;
/** A4 width (595.28pt) minus both margins. */
const CONTENT_WIDTH = 515;
const THUMB_SIZE = 78;
const THUMB_GAP = 14;

const COLORS = {
  ink: '#111827',
  body: '#37493F',
  muted: '#6B7971',
  rule: '#E0E3E1',
  soft: '#F7F8F8',
  accent: '#E60F04',
  white: '#FFFFFF',
};

export interface CreativeExportMeta {
  status?: string;
  industry?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  generatedAt?: Date;
}

/**
 * Renders the Creative Review export as an A4 PDF.
 *
 * Each creative gets a card with the image thumbnail and the nine business
 * fields the product requested, followed by the full version history (all
 * versions, latest first) with review action, actor and comments.
 *
 * Images are fetched at render time and normalised through sharp so WebP and
 * large uploads embed consistently; a failed thumbnail never fails the report.
 */
@Injectable()
export class CreativePdfService {
  private readonly logger = new Logger(CreativePdfService.name);

  constructor(private readonly storage: StorageService) {}

  async render(rows: CreativeExportRow[], meta: CreativeExportMeta = {}): Promise<Buffer> {
    const thumbnails = await this.loadThumbnails(rows);
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: 'Creative Review Report',
        Author: 'GrubMedia Government Portal',
        Subject: 'Creative review export',
      },
    });

    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawCover(doc, rows.length, meta);
    rows.forEach((row, index) => {
      this.drawCreative(doc, row, thumbnails.get(row.id) ?? null, index === 0);
    });
    if (rows.length === 0) {
      doc.moveDown(2);
      doc
        .font('Helvetica-Oblique')
        .fontSize(11)
        .fillColor(COLORS.muted)
        .text('No creatives matched the selected export filters.', PAGE_MARGIN, doc.y, {
          width: CONTENT_WIDTH,
          align: 'center',
        });
    }
    this.drawFooters(doc);
    doc.end();
    return done;
  }

  // -------------------------------------------------------------------------
  // Page furniture
  // -------------------------------------------------------------------------

  private drawCover(doc: PDFKit.PDFDocument, total: number, meta: CreativeExportMeta): void {
    doc.rect(0, 0, doc.page.width, 8).fill(COLORS.accent);
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(COLORS.ink)
      .text('Creative Review Report', PAGE_MARGIN, PAGE_MARGIN);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(
        `Generated ${this.formatDate(meta.generatedAt ?? new Date())}  •  ${total} creative${total === 1 ? '' : 's'}`,
        PAGE_MARGIN,
        doc.y + 2,
      );

    const filters = [
      meta.status ? `Status: ${this.clean(meta.status)}` : null,
      meta.industry ? `Industry: ${this.clean(meta.industry)}` : null,
      meta.search ? `Search: ${this.clean(meta.search)}` : null,
      meta.startDate || meta.endDate
        ? `Uploaded: ${this.clean(meta.startDate ?? 'any')} → ${this.clean(meta.endDate ?? 'any')}`
        : null,
    ].filter((value): value is string => Boolean(value));
    if (filters.length > 0) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(filters.join('   |   '), PAGE_MARGIN, doc.y + 4, { width: CONTENT_WIDTH });
    }
    doc
      .moveTo(PAGE_MARGIN, doc.y + 10)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 10)
      .strokeColor(COLORS.rule)
      .lineWidth(1)
      .stroke();
    doc.y += 20;
  }

  private drawFooters(doc: PDFKit.PDFDocument): void {
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const page = doc.page;
      // The footer deliberately lives in the bottom margin. PDFKit would
      // otherwise treat the y position as overflow and append a fresh page for
      // every footer line (turning an 8-page report into 24 pages).
      const marginBottom = page.margins.bottom;
      page.margins.bottom = 0;
      const footerY = page.height - 30;
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text('GrubMedia Government Portal — Creative Review', PAGE_MARGIN, footerY, {
          width: CONTENT_WIDTH / 2,
          align: 'left',
          lineBreak: false,
        })
        .text(
          `Page ${index - range.start + 1} of ${range.count}`,
          PAGE_MARGIN + CONTENT_WIDTH / 2,
          footerY,
          {
            width: CONTENT_WIDTH / 2,
            align: 'right',
            lineBreak: false,
          },
        );
      page.margins.bottom = marginBottom;
    }
  }

  // -------------------------------------------------------------------------
  // Creative card
  // -------------------------------------------------------------------------

  private drawCreative(
    doc: PDFKit.PDFDocument,
    row: CreativeExportRow,
    thumbnail: Buffer | null,
    first: boolean,
  ): void {
    const estimatedHeight = 150 + row.versions.length * 26;
    this.ensureSpace(doc, Math.min(estimatedHeight, 260));

    const top = doc.y;
    const infoX = PAGE_MARGIN + THUMB_SIZE + THUMB_GAP;
    const infoWidth = CONTENT_WIDTH - THUMB_SIZE - THUMB_GAP;
    const columnWidth = infoWidth / 2;

    this.drawThumbnail(doc, thumbnail, PAGE_MARGIN, top, row.media_name ?? row.creative_name);

    // Header: creative name, then the business fields in two columns.
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLORS.ink)
      .text(this.clean(row.creative_name), infoX, top, {
        width: infoWidth,
        height: 15,
        ellipsis: true,
      });

    const fields: Array<[string, string]> = [
      ['Creative ID', row.id],
      ['Approval Status', this.prettyStatus(row.approval_status)],
      ['Industry', this.text(row.industry)],
      ['Media Name', this.text(row.media_name)],
      ['Agency', this.text(row.agency_name)],
      ['Location', this.text(row.location)],
      ['Uploaded On', this.formatDate(row.uploaded_on)],
      ['Last Action By', this.text(row.last_action_by)],
    ];
    let fieldY = top + 19;
    for (let index = 0; index < fields.length; index += 2) {
      const [leftLabel, leftValue] = fields[index];
      this.drawField(doc, leftLabel, leftValue, infoX, fieldY, columnWidth - 10);
      if (fields[index + 1]) {
        const [rightLabel, rightValue] = fields[index + 1];
        this.drawField(doc, rightLabel, rightValue, infoX + columnWidth, fieldY, columnWidth - 4);
      }
      fieldY += 27;
    }

    doc.y = Math.max(fieldY, top + THUMB_SIZE) + 6;
    this.drawVersionTable(doc, row.versions);

    doc
      .moveTo(PAGE_MARGIN, doc.y + 8)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y + 8)
      .strokeColor(COLORS.rule)
      .lineWidth(first ? 1 : 1)
      .stroke();
    doc.y += 18;
  }

  private drawField(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
  ): void {
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(label.toUpperCase(), x, y, { width, lineBreak: false, characterSpacing: 0.4 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.body)
      .text(value, x, y + 10, { width, height: 12, ellipsis: true, lineBreak: false });
  }

  private drawThumbnail(
    doc: PDFKit.PDFDocument,
    thumbnail: Buffer | null,
    x: number,
    y: number,
    fallbackLabel: string,
  ): void {
    doc.rect(x, y, THUMB_SIZE, THUMB_SIZE).fillAndStroke(COLORS.soft, COLORS.rule);
    if (thumbnail) {
      try {
        doc.image(thumbnail, x + 2, y + 2, {
          fit: [THUMB_SIZE - 4, THUMB_SIZE - 4],
          align: 'center',
          valign: 'center',
        });
        return;
      } catch (error) {
        this.logger.warn(`Thumbnail embed failed: ${(error as Error).message}`);
      }
    }
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(COLORS.muted)
      .text(this.clean(fallbackLabel || 'NO IMAGE'), x + 4, y + THUMB_SIZE / 2 - 6, {
        width: THUMB_SIZE - 8,
        align: 'center',
        height: 14,
        ellipsis: true,
      });
  }

  // -------------------------------------------------------------------------
  // Version history table
  // -------------------------------------------------------------------------

  private drawVersionTable(doc: PDFKit.PDFDocument, versions: CreativeExportVersionRow[]): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(`Version history (${versions.length})`, PAGE_MARGIN, doc.y + 2);
    doc.y += 15;

    if (versions.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text('No versions uploaded.', PAGE_MARGIN, doc.y);
      return;
    }

    this.drawVersionHeader(doc);
    for (const version of versions) {
      const notes = this.versionNotes(version);
      const heights = this.measureNotes(doc, notes);
      const rowHeight = this.versionRowHeight(heights);
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        this.drawVersionHeader(doc);
      }
      this.drawVersionRow(doc, version, notes, heights, rowHeight);
    }
  }

  private drawVersionHeader(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    const headerHeight = 16;
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, headerHeight).fill(COLORS.soft);
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(COLORS.muted);
    let x = PAGE_MARGIN + 5;
    for (const column of VERSION_COLUMNS) {
      doc.text(column.label.toUpperCase(), x, y + 5, {
        width: column.width - 6,
        lineBreak: false,
        characterSpacing: 0.3,
      });
      x += column.width;
    }
    doc.y = y + headerHeight;
  }

  private drawVersionRow(
    doc: PDFKit.PDFDocument,
    version: CreativeExportVersionRow,
    notes: string[],
    noteHeights: number[],
    rowHeight: number,
  ): void {
    const y = doc.y;
    const values = [
      `v${version.version_number}`,
      this.text(version.media_name),
      this.prettyStatus(version.status),
      this.formatDateShort(version.uploaded_on),
      this.text(version.uploaded_by),
      this.formatBytes(version.file_size_bytes),
      version.last_action
        ? `${this.prettyAction(version.last_action)}${version.last_action_by ? ` by ${this.clean(version.last_action_by)}` : ''}`
        : '—',
    ];
    doc.font('Helvetica').fontSize(7.2).fillColor(COLORS.body);
    let x = PAGE_MARGIN + 5;
    values.forEach((value, index) => {
      const column = VERSION_COLUMNS[index];
      doc.text(this.clean(value), x, y + 6, {
        width: column.width - 6,
        height: 10,
        ellipsis: true,
        lineBreak: false,
      });
      x += column.width;
    });
    if (notes.length > 0) {
      let noteY = y + 19;
      notes.forEach((note, index) => {
        doc.font('Helvetica').fontSize(6.6).fillColor(COLORS.muted);
        doc.text(this.clean(note), PAGE_MARGIN + 10, noteY, {
          width: CONTENT_WIDTH - 20,
          lineGap: 0,
        });
        noteY += noteHeights[index] ?? 9;
      });
    }
    doc
      .moveTo(PAGE_MARGIN, y + rowHeight)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y + rowHeight)
      .strokeColor(COLORS.rule)
      .lineWidth(0.4)
      .stroke();
    doc.y = y + rowHeight;
  }

  /** Full wrapped height of each reason/comments line at the table's note font. */
  private measureNotes(doc: PDFKit.PDFDocument, notes: string[]): number[] {
    if (notes.length === 0) return [];
    doc.font('Helvetica').fontSize(6.6);
    return notes.map((note) =>
      Math.max(9, doc.heightOfString(this.clean(note), { width: CONTENT_WIDTH - 20, lineGap: 0 })),
    );
  }

  private versionRowHeight(noteHeights: number[]): number {
    if (noteHeights.length === 0) return 24;
    return 24 + noteHeights.reduce((total, height) => total + height, 0);
  }

  private versionNotes(version: CreativeExportVersionRow): string[] {
    const notes: string[] = [];
    if (version.reason) notes.push(`Reason: ${version.reason}`);
    if (version.comments) notes.push(`Comments: ${version.comments}`);
    return notes;
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  private async loadThumbnails(rows: CreativeExportRow[]): Promise<Map<string, Buffer | null>> {
    const thumbnails = new Map<string, Buffer | null>();
    const queue = [...rows];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        thumbnails.set(next.id, await this.fetchThumbnail(next.thumbnail_url));
      }
    });
    await Promise.all(workers);
    return thumbnails;
  }

  private async fetchThumbnail(url: string | null): Promise<Buffer | null> {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const direct = await this.tryFetchImage(url);
    if (direct) return direct;
    // Private buckets: retry with a short-lived presigned GET.
    try {
      const key = this.storage.extractKeyFromUrl(url);
      if (!key) return null;
      const signed = await this.storage.presignedDownloadUrl(key);
      return await this.tryFetchImage(signed);
    } catch (error) {
      this.logger.warn(`Thumbnail fallback failed: ${(error as Error).message}`);
      return null;
    }
  }

  private async tryFetchImage(url: string): Promise<Buffer | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      if (!response.ok) return null;
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > 20 * 1024 * 1024) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) return null;
      return await sharp(buffer)
        .rotate()
        .resize(240, 240, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  private ensureSpace(doc: PDFKit.PDFDocument, height: number): void {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 24) {
      doc.addPage();
    }
  }

  private formatDate(value: Date | string | null | undefined): string {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private formatDateShort(value: Date | string | null | undefined): string {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private text(value: string | null | undefined): string {
    const clean = value?.toString().trim();
    return clean ? clean : '—';
  }

  private prettyStatus(value: string | null | undefined): string {
    if (!value) return '—';
    return value
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private prettyAction(value: string | null | undefined): string {
    if (!value) return '—';
    const map: Record<string, string> = {
      APPROVE: 'Approved',
      REJECT: 'Rejected',
      HOLD: 'Put on hold',
      REQUEST_CHANGES: 'Changes requested',
      RESUME: 'Resumed',
    };
    return map[value] ?? this.prettyStatus(value);
  }

  /** PDF standard fonts only encode WinAnsi; replace unsupported glyphs. */
  private clean(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, '?');
  }
}

const VERSION_COLUMNS: Array<{ key: string; label: string; width: number }> = [
  { key: 'version', label: 'Ver', width: 26 },
  { key: 'media', label: 'Media Name', width: 112 },
  { key: 'status', label: 'Status', width: 62 },
  { key: 'uploaded', label: 'Uploaded On', width: 74 },
  { key: 'uploader', label: 'Uploaded By', width: 78 },
  { key: 'size', label: 'Size', width: 48 },
  { key: 'action', label: 'Last Action', width: 115 },
];
