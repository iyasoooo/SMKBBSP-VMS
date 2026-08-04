import { describe, expect, it } from 'vitest';
import { escapeForSpreadsheet, safeFilename } from '@/lib/reports/xlsx';

/**
 * Spreadsheet formula injection.
 *
 * The visitor name and purpose are free text typed by a member of the public
 * and both end up in an exported cell. Excel, LibreOffice and Google Sheets
 * all execute a cell that begins with `=`, `+`, `-` or `@`, so an unescaped
 * export turns a visitor registration form into remote code execution against
 * whoever opens the report.
 */
describe('escapeForSpreadsheet', () => {
  it('neutralises every formula trigger character', () => {
    for (const trigger of ['=', '+', '-', '@']) {
      const hostile = `${trigger}cmd|'/c calc'!A1`;
      const escaped = escapeForSpreadsheet(hostile);

      expect(escaped.startsWith("'")).toBe(true);
      // The original text is preserved, just rendered inert.
      expect(escaped.slice(1)).toBe(hostile);
    }
  });

  it('neutralises the classic DDE and HYPERLINK payloads', () => {
    expect(escapeForSpreadsheet('=HYPERLINK("http://evil.test","click")')).toBe(
      '\'=HYPERLINK("http://evil.test","click")',
    );
    expect(escapeForSpreadsheet("@SUM(1+1)*cmd|' /C calc'!A0").startsWith("'")).toBe(true);
  });

  it('escapes leading tab and carriage return, which also start a formula', () => {
    expect(escapeForSpreadsheet('\t=1+1').startsWith("'")).toBe(true);
    expect(escapeForSpreadsheet('\r=1+1').startsWith("'")).toBe(true);
  });

  it('leaves ordinary values untouched', () => {
    for (const safe of [
      'Nurul Huda binti Ismail',
      'VP-26C4-9XQT',
      '******-**-5523',
      'Discuss my child results',
      '',
    ]) {
      expect(escapeForSpreadsheet(safe)).toBe(safe);
    }
  });

  it('does not mangle a value that merely contains a trigger character', () => {
    // Only a *leading* trigger is dangerous.
    expect(escapeForSpreadsheet('Ali=Bob')).toBe('Ali=Bob');
    expect(escapeForSpreadsheet('a-b-c')).toBe('a-b-c');
  });
});

describe('safeFilename', () => {
  it('strips path separators and traversal attempts', () => {
    expect(safeFilename('../../etc/passwd', 'xlsx')).toBe('etc-passwd.xlsx');
    expect(safeFilename('report\\..\\secret', 'pdf')).toBe('report-secret.pdf');
  });

  it('strips characters that could break a Content-Disposition header', () => {
    const result = safeFilename('report"; drop\r\nX-Evil: 1', 'xlsx');
    expect(result).not.toContain('"');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result.endsWith('.xlsx')).toBe(true);
  });

  it('keeps a normal generated name readable', () => {
    expect(safeFilename('visitorpass-report-2026-03-01-to-2026-03-31', 'xlsx')).toBe(
      'visitorpass-report-2026-03-01-to-2026-03-31.xlsx',
    );
  });

  it('falls back to a default when nothing usable remains', () => {
    expect(safeFilename('///', 'pdf')).toBe('report.pdf');
  });
});
