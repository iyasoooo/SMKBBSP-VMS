import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { REPORT_COLUMNS, type ReportResult } from '@/lib/reports/query';
import { formatDateTime } from '@/lib/time';

/**
 * PDF export.
 *
 * Built with pdf-lib and the standard Helvetica faces: no headless browser, no
 * embedded font files, no native dependency to compile on a marking machine.
 * The trade-off is that layout is done by hand, which is why the column widths
 * and pagination below are explicit.
 *
 * Landscape A4 is used because the report has fourteen columns.
 */

const PAGE_WIDTH = 841.89; // A4 landscape
const PAGE_HEIGHT = 595.28;
const MARGIN = 32;
const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 20;

const NAVY = rgb(0.149, 0.263, 0.478);
const TEXT = rgb(0.12, 0.17, 0.25);
const MUTED = rgb(0.4, 0.45, 0.53);
const STRIPE = rgb(0.96, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);

/** Column widths in points, proportional to the shared column definitions. */
const TOTAL_UNITS = REPORT_COLUMNS.reduce((sum, column) => sum + column.width, 0);
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;

function columnWidths(): number[] {
  return REPORT_COLUMNS.map((column) => (column.width / TOTAL_UNITS) * USABLE_WIDTH);
}

/**
 * Truncate to fit a column, adding an ellipsis.
 * Also strips characters outside WinAnsi, which the standard fonts cannot
 * encode and which would otherwise throw during save.
 */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = text.replace(/[^\x20-\x7E -ÿ]/g, '');
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;

  let low = 0;
  let high = safe.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${safe.slice(0, mid)}...`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${safe.slice(0, low)}...`;
}

export async function buildReportPdf(
  report: ReportResult,
  options: { schoolName: string; generatedAt?: Date },
): Promise<Buffer> {
  const generatedAt = options.generatedAt ?? new Date();

  const pdf = await PDFDocument.create();
  pdf.setTitle('Visitor report');
  pdf.setProducer('SMKBBSP VisitorPass');
  pdf.setCreationDate(generatedAt);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const widths = columnWidths();

  // Pages are laid out first, numbered afterwards, so "Page 1 of N" can state
  // a total that is only known once every row has been placed.
  const pages: PDFPage[] = [];

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  let cursorY = drawPageHeader(page, { bold, regular, report, generatedAt, ...options });
  cursorY = drawTableHeader(page, bold, widths, cursorY);

  let striped = false;

  for (const row of report.rows) {
    if (cursorY - ROW_HEIGHT < MARGIN + 24) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pages.push(page);
      cursorY = PAGE_HEIGHT - MARGIN;
      cursorY = drawTableHeader(page, bold, widths, cursorY);
      striped = false;
    }

    if (striped) {
      page.drawRectangle({
        x: MARGIN,
        y: cursorY - ROW_HEIGHT + 4,
        width: USABLE_WIDTH,
        height: ROW_HEIGHT,
        color: STRIPE,
      });
    }
    striped = !striped;

    let x = MARGIN;
    REPORT_COLUMNS.forEach((column, index) => {
      const width = widths[index] ?? 0;
      const raw = row[column.key];
      const value = raw === null || raw === undefined ? '-' : String(raw);

      page.drawText(fit(value, regular, 7, width - 6), {
        x: x + 3,
        y: cursorY - ROW_HEIGHT + 9,
        size: 7,
        font: regular,
        color: TEXT,
      });
      x += width;
    });

    cursorY -= ROW_HEIGHT;
  }

  if (report.rows.length === 0) {
    page.drawText('No records match the selected filters.', {
      x: MARGIN,
      y: cursorY - 20,
      size: 10,
      font: regular,
      color: MUTED,
    });
  }

  // Footer with page numbers, now that the total is known.
  pages.forEach((target, index) => {
    target.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 70,
      y: MARGIN - 14,
      size: 8,
      font: regular,
      color: MUTED,
    });
    target.drawText('Identity numbers are masked. Not for external distribution.', {
      x: MARGIN,
      y: MARGIN - 14,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return Buffer.from(await pdf.save());
}

function drawPageHeader(
  page: PDFPage,
  context: {
    bold: PDFFont;
    regular: PDFFont;
    report: ReportResult;
    generatedAt: Date;
    schoolName: string;
  },
): number {
  const { bold, regular, report, generatedAt, schoolName } = context;
  let y = PAGE_HEIGHT - MARGIN;

  page.drawRectangle({
    x: MARGIN,
    y: y - 34,
    width: USABLE_WIDTH,
    height: 34,
    color: NAVY,
  });

  page.drawText('Visitor report', {
    x: MARGIN + 10,
    y: y - 15,
    size: 13,
    font: bold,
    color: WHITE,
  });
  page.drawText(fit(schoolName, regular, 9, 400), {
    x: MARGIN + 10,
    y: y - 27,
    size: 9,
    font: regular,
    color: WHITE,
  });
  page.drawText(`Generated ${formatDateTime(generatedAt)}`, {
    x: PAGE_WIDTH - MARGIN - 170,
    y: y - 15,
    size: 8,
    font: regular,
    color: WHITE,
  });
  page.drawText(`${report.total} record(s)`, {
    x: PAGE_WIDTH - MARGIN - 170,
    y: y - 27,
    size: 8,
    font: regular,
    color: WHITE,
  });

  y -= 46;

  // Filter summary, so a printed sheet always states what produced it.
  const half = Math.ceil(report.summary.length / 2);
  report.summary.forEach((line, index) => {
    const column = index < half ? 0 : 1;
    const row = index < half ? index : index - half;
    page.drawText(fit(line, regular, 8, USABLE_WIDTH / 2 - 12), {
      x: MARGIN + column * (USABLE_WIDTH / 2),
      y: y - row * 10,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return y - half * 10 - 8;
}

function drawTableHeader(
  page: PDFPage,
  bold: PDFFont,
  widths: number[],
  startY: number,
): number {
  page.drawRectangle({
    x: MARGIN,
    y: startY - HEADER_HEIGHT + 4,
    width: USABLE_WIDTH,
    height: HEADER_HEIGHT,
    color: NAVY,
  });

  let x = MARGIN;
  REPORT_COLUMNS.forEach((column, index) => {
    const width = widths[index] ?? 0;
    page.drawText(fit(column.label, bold, 7, width - 6), {
      x: x + 3,
      y: startY - HEADER_HEIGHT + 11,
      size: 7,
      font: bold,
      color: WHITE,
    });
    x += width;
  });

  return startY - HEADER_HEIGHT;
}
