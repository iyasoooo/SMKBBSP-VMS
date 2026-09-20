import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import { formatDate, formatTimeRange } from '@/lib/time';

/**
 * The visitor's pass as a file they can keep.
 *
 * The point is offline: the pass normally lives on a page that needs the
 * network, and a visitor standing at the gate on a bad signal cannot open it.
 * A saved file opens anyway, and the QR inside it scans exactly as the page
 * does because both encode the same pass URL.
 *
 * Built with pdf-lib and the standard Helvetica faces, matching the report
 * exporter: no headless browser and no font files to ship. Laid out by hand,
 * which is why the coordinates below are explicit.
 *
 * It carries only what the pass on screen carries. No identity number, no
 * phone, no purpose - this is a file that gets forwarded and left in inboxes.
 */

// A6 landscape: a pass, not a document. Large enough for the QR to scan from a
// phone screen, small enough that it does not read as paperwork.
const PAGE_WIDTH = 419.53;
const PAGE_HEIGHT = 297.64;
const MARGIN = 24;

const INK = rgb(0, 0, 0);
const MUTED = rgb(0.35, 0.4, 0.47);

export interface PassPdfData {
  schoolName: string;
  referenceNumber: string;
  visitorName: string;
  hostName: string;
  destinationName: string;
  validFrom: Date;
  expiresAt: Date;
  /** PNG data URL, as produced by `renderQrDataUrl`. */
  qrDataUrl: string;
  fallbackCode: string;
  partySize: number;
}

/** Strip the `data:image/png;base64,` prefix pdf-lib does not want. */
function decodeDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

/**
 * The crest, if it can be read.
 *
 * A missing or unreadable file must not cost the visitor their pass, so this
 * degrades to no crest rather than throwing.
 */
async function loadCrest(pdf: PDFDocument): Promise<PDFImage | null> {
  try {
    const bytes = await readFile(join(process.cwd(), 'public', 'brand', 'crest.png'));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function buildPassPdf(data: PassPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  pdf.setTitle(`Visitor pass ${data.referenceNumber}`);
  pdf.setProducer(data.schoolName);
  // No author or subject: both would carry a person's name into file metadata,
  // where nobody looking at the pass would think to check it.

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  const qr = await pdf.embedPng(decodeDataUrl(data.qrDataUrl));
  const crest = await loadCrest(pdf);

  let y = PAGE_HEIGHT - MARGIN;

  // ---- Header: crest, school, VISITOR, reference ----
  if (crest) {
    const crestHeight = 30;
    const crestWidth = (crest.width / crest.height) * crestHeight;
    page.drawImage(crest, { x: MARGIN, y: y - crestHeight, width: crestWidth, height: crestHeight });
  }

  const textLeft = crest ? MARGIN + 38 : MARGIN;

  page.drawText(data.schoolName.toUpperCase(), {
    x: textLeft,
    y: y - 9,
    size: 7,
    font: bold,
    color: INK,
  });
  page.drawText('VISITOR', { x: textLeft, y: y - 29, size: 22, font: bold, color: INK });

  const reference = data.referenceNumber;
  const referenceWidth = bold.widthOfTextAtSize(reference, 10);
  label(page, regular, 'REFERENCE', PAGE_WIDTH - MARGIN - referenceWidth, y - 9);
  page.drawText(reference, {
    x: PAGE_WIDTH - MARGIN - referenceWidth,
    y: y - 25,
    size: 10,
    font: bold,
    color: INK,
  });

  y -= 40;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1.5,
    color: INK,
  });

  // ---- Body: details on the left, QR on the right ----
  const qrSize = 108;
  const qrX = PAGE_WIDTH - MARGIN - qrSize;
  y -= 16;

  page.drawImage(qr, { x: qrX, y: y - qrSize, width: qrSize, height: qrSize });
  centred(page, regular, 'Scan at the guard house', qrX + qrSize / 2, y - qrSize - 10, 6.5);

  const detailWidth = qrX - MARGIN - 14;

  label(page, regular, 'NAME', MARGIN, y);
  page.drawText(truncate(data.visitorName, bold, 14, detailWidth), {
    x: MARGIN,
    y: y - 18,
    size: 14,
    font: bold,
    color: INK,
  });

  y -= 38;

  const rows: Array<[string, string]> = [
    ['HOST', data.hostName],
    ['DESTINATION', data.destinationName],
    ['DATE', formatDate(data.validFrom)],
    ['VALID', formatTimeRange(data.validFrom, data.expiresAt)],
  ];

  for (const [key, value] of rows) {
    label(page, regular, key, MARGIN, y);
    page.drawText(truncate(value, bold, 9, detailWidth), {
      x: MARGIN,
      y: y - 12,
      size: 9,
      font: bold,
      color: INK,
    });
    y -= 26;
  }

  // ---- Footer: fallback code and the one instruction that matters ----
  const footerY = MARGIN + 22;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 16 },
    end: { x: PAGE_WIDTH - MARGIN, y: footerY + 16 },
    thickness: 1.5,
    color: INK,
  });

  label(page, regular, 'IF THE SCANNER FAILS', MARGIN, footerY + 8);
  page.drawText(data.fallbackCode, {
    x: MARGIN,
    y: footerY - 6,
    size: 12,
    font: bold,
    color: INK,
  });

  const note =
    data.partySize > 1
      ? `Show this at the guard house. Party of ${data.partySize} people.`
      : 'Show this at the guard house.';
  const noteWidth = regular.widthOfTextAtSize(note, 7);
  page.drawText(note, {
    x: PAGE_WIDTH - MARGIN - noteWidth,
    y: footerY - 2,
    size: 7,
    font: regular,
    color: MUTED,
  });

  return pdf.save();
}

function label(
  page: ReturnType<PDFDocument['addPage']>,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
): void {
  page.drawText(text, { x, y, size: 6, font, color: MUTED });
}

function centred(
  page: ReturnType<PDFDocument['addPage']>,
  font: PDFFont,
  text: string,
  centreX: number,
  y: number,
  size: number,
): void {
  page.drawText(text, { x: centreX - font.widthOfTextAtSize(text, size) / 2, y, size, font, color: MUTED });
}

/**
 * Cut a value to the space it has.
 *
 * Long Malaysian names are normal, and pdf-lib does not wrap or clip: an
 * overlong string would simply run across the QR and stop it scanning.
 */
function truncate(value: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;

  let cut = value;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}
