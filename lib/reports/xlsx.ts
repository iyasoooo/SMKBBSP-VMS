import ExcelJS from 'exceljs';
import { REPORT_COLUMNS, type ReportResult, type ReportRow } from '@/lib/reports/query';
import { formatDateTime } from '@/lib/time';

/**
 * XLSX export.
 *
 * The security-relevant part is `escapeForSpreadsheet`. Excel, LibreOffice and
 * Google Sheets all treat a cell beginning with `=`, `+`, `-` or `@` as a
 * formula, so a visitor who registers under the name `=cmd|'/c calc'!A1` gets
 * that formula executed on whoever opens the export. Prefixing with an
 * apostrophe forces the cell to be read as text.
 *
 * This matters here specifically because the visitor name and purpose are
 * free text supplied by a member of the public.
 */

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

export function escapeForSpreadsheet(value: string): string {
  if (value.length === 0) return value;
  return FORMULA_TRIGGERS.some((trigger) => value.startsWith(trigger)) ? `'${value}` : value;
}

export async function buildReportWorkbook(
  report: ReportResult,
  options: { schoolName: string; generatedAt?: Date },
): Promise<Buffer> {
  const generatedAt = options.generatedAt ?? new Date();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SMKBBSP Visitor Management System';
  workbook.created = generatedAt;

  // --- Filters sheet -------------------------------------------------------
  const info = workbook.addWorksheet('Report info');
  info.columns = [
    { header: 'Field', key: 'field', width: 24 },
    { header: 'Value', key: 'value', width: 60 },
  ];
  info.getRow(1).font = { bold: true };

  info.addRow({ field: 'School', value: escapeForSpreadsheet(options.schoolName) });
  info.addRow({ field: 'Generated', value: formatDateTime(generatedAt) });
  info.addRow({ field: 'Total records', value: report.total });
  for (const line of report.summary) {
    const [field, ...rest] = line.split(': ');
    info.addRow({
      field: escapeForSpreadsheet(field ?? ''),
      value: escapeForSpreadsheet(rest.join(': ')),
    });
  }

  // --- Data sheet ----------------------------------------------------------
  const sheet = workbook.addWorksheet('Visits');
  sheet.columns = REPORT_COLUMNS.map((column) => ({
    header: column.label,
    key: column.key,
    width: column.width,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF26437A' } };
  header.alignment = { vertical: 'middle' };
  header.height = 20;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of report.rows) {
    sheet.addRow(toSheetRow(row));
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: REPORT_COLUMNS.length },
  };

  // Duration is genuinely numeric, so it stays a number and sorts correctly.
  const durationIndex = REPORT_COLUMNS.findIndex((column) => column.key === 'durationMinutes') + 1;
  sheet.getColumn(durationIndex).numFmt = '0';
  sheet.getColumn(durationIndex).alignment = { horizontal: 'right' };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function toSheetRow(row: ReportRow): Record<string, string | number | null> {
  const output: Record<string, string | number | null> = {};

  for (const column of REPORT_COLUMNS) {
    const value = row[column.key];
    if (column.key === 'durationMinutes') {
      output[column.key] = typeof value === 'number' ? value : null;
    } else {
      output[column.key] = escapeForSpreadsheet(String(value ?? ''));
    }
  }

  return output;
}

/**
 * Build a safe download filename. Anything outside a conservative allow-list
 * is stripped so a filter value can never inject a path separator or a
 * Content-Disposition header break.
 */
export function safeFilename(base: string, extension: string): string {
  // Dots are dropped from the base as well as separators. They cannot traverse
  // once `/` and `\` are gone, but stripping them keeps `..` out of the
  // filename entirely rather than leaving a confusing `report-..-secret`.
  const cleaned = base
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${cleaned || 'report'}.${extension}`;
}
