import QRCode from 'qrcode';

/**
 * QR generation.
 *
 * The encoded payload is only ever a pass URL whose single variable part is an
 * opaque 256-bit token: `https://<host>/v/<token>`. It contains no name, no
 * identity number, no email, no host, no purpose, and no database id. Decoding
 * a stolen QR yields a URL that is useless once the credential window closes
 * or the pass is revoked.
 *
 * Images are generated at presentation time from the raw token supplied by the
 * request (the visitor's own URL) and are never persisted, so the database
 * never holds a renderable pass.
 */

export interface QrRenderOptions {
  /** Pixel width of the generated image. */
  width?: number;
  /** Quiet-zone modules. Below 2 many scanners struggle. */
  margin?: number;
}

/**
 * Error correction level M tolerates roughly 15% damage. Chosen over H because
 * a badge is printed on ordinary paper and carried for an hour, not laminated
 * and reused; M keeps the modules larger and easier to scan on a cheap tablet
 * camera.
 */
const ERROR_CORRECTION = 'M' as const;

/** PNG data URI, suitable for an <img src> in an email or on screen. */
export async function renderQrDataUrl(
  payload: string,
  options: QrRenderOptions = {},
): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: options.margin ?? 2,
    width: options.width ?? 320,
    color: { dark: '#1a1512ff', light: '#ffffffff' },
  });
}

/**
 * SVG markup, used for print. A vector badge stays crisp at any printer DPI,
 * where a 320px PNG would visibly pixelate on A4.
 */
export async function renderQrSvg(
  payload: string,
  options: QrRenderOptions = {},
): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: options.margin ?? 2,
    width: options.width ?? 200,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}

/** Build the pass URL that a QR encodes. */
export function buildPassUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/$/, '')}/v/${rawToken}`;
}
