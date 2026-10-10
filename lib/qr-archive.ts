import 'server-only';
import QRCode from 'qrcode';
import sharp from 'sharp';
import JSZip from 'jszip';
import { Readable } from 'node:stream';
import { decryptToken } from './qr';
import { AppError } from './auth';

export function registrationOrigin() {
  const value = process.env.APP_ORIGIN;
  if (!value) throw new AppError('APP_ORIGIN is required for printed QR codes.', 503);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('APP_ORIGIN must be the canonical HTTPS origin.', 503);
  }
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw new AppError(
      'APP_ORIGIN must be the canonical HTTPS origin (localhost allowed for development).',
      503,
    );
  return url.origin;
}
export function registrationUrl(token: string) {
  return `${registrationOrigin()}/register?key=${token}`;
}
// A small embedded print alphabet keeps labels deterministic on hosts without fonts.
const alphabet: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};
function serialLabel(serial: string) {
  const scale = Math.min(5, Math.floor(750 / (serial.length * 6)));
  const left = (800 - (serial.length * 6 - 1) * scale) / 2;
  const path = [...serial]
    .flatMap((char, i) =>
      alphabet[char].flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === '1'
            ? `M${left + (i * 6 + x) * scale},${28 + y * scale}h${scale}v${scale}h-${scale}z`
            : '',
        ),
      ),
    )
    .join('');
  return Buffer.from(
    `<svg width="800" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="100" fill="white"/><path d="${path}" fill="black"/></svg>`,
  );
}
export async function printableQr(serial: string, payload: string) {
  if (!/^FARL-QR-\d{1,20}$/.test(serial)) throw new Error('Invalid QR serial.');
  const modules = QRCode.create(payload, { errorCorrectionLevel: 'H' }).modules.size + 8;
  const scale = Math.floor(800 / modules);
  const inset = Math.floor((800 - modules * scale) / 2);
  const qr = await QRCode.toBuffer(payload, {
    scale,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  });
  const label = serialLabel(serial);
  return sharp({ create: { width: 800, height: 900, channels: 3, background: '#ffffff' } })
    .composite([
      { input: qr, top: inset, left: inset },
      { input: label, top: 800, left: 0 },
    ])
    .png()
    .toBuffer();
}
type ArchiveRow = { serial_number: string; encrypted_token: string };
async function prepareArchive(rows: ArchiveRow[]) {
  const zip = new JSZip();
  // Sequential rendering bounds memory on small Node hosts.
  for (const row of rows) {
    zip.file(
      `${row.serial_number}.png`,
      await printableQr(row.serial_number, registrationUrl(decryptToken(row.encrypted_token))),
    );
  }
  return zip;
}
export async function qrArchive(rows: ArchiveRow[]) {
  return (await prepareArchive(rows)).generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}
export async function qrArchiveStream(rows: ArchiveRow[]) {
  const stream = (await prepareArchive(rows)).generateNodeStream({
    streamFiles: true,
    compression: 'STORE',
  });
  // JSZip uses readable-stream v2; adapt it to native Node/Web response streams.
  return new Readable().wrap(stream);
}
