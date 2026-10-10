import { expect, it } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';
import {
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  QRCodeReader,
  DecodeHintType,
} from '@zxing/library';
import { qrArchive, qrArchiveStream, registrationUrl } from '../lib/qr-archive';
import { generateToken, encryptToken } from '../lib/qr';

it('renders 300 individually named, printable PNGs in a valid ZIP with decodable URLs', async () => {
  process.env.APP_ORIGIN = 'https://farlands.example.org';
  process.env.QR_ENCRYPTION_KEY = 'ab'.repeat(32);
  const tokens = Array.from({ length: 300 }, generateToken);
  const rows = tokens.map((token, i) => ({
    serial_number: `FARL-QR-${String(i + 1).padStart(4, '0')}`,
    encrypted_token: encryptToken(token),
  }));
  const archive = await qrArchive(rows);
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  expect(Object.keys(zip.files)).toHaveLength(300);
  for (const row of rows) {
    const png = await zip.file(`${row.serial_number}.png`)!.async('nodebuffer');
    const metadata = await sharp(png).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', 800, 900]);
  }
  for (let i = 0; i < rows.length; i++) {
    const png = await zip.file(`${rows[i].serial_number}.png`)!.async('nodebuffer');
    const pixels = await sharp(png).removeAlpha().greyscale().raw().toBuffer();
    expect(pixels[0]).toBe(255); // white quiet zone
    expect(pixels.subarray(800 * 800).some((p) => p < 128)).toBe(true); // serial is in the image
    // Check encoded image data independently of camera finder-pattern heuristics.
    const source = new RGBLuminanceSource(
      new Uint8ClampedArray(pixels.subarray(0, 800 * 800)),
      800,
      800,
    );
    const decoded = new QRCodeReader()
      .decode(
        new BinaryBitmap(new HybridBinarizer(source)),
        new Map([[DecodeHintType.PURE_BARCODE, true]]),
      )
      .getText();
    expect(decoded).toBe(registrationUrl(tokens[i]));
  }
}, 60000);

it('requires a configured canonical HTTPS origin for printing', () => {
  delete process.env.APP_ORIGIN;
  expect(() => registrationUrl(generateToken())).toThrow(/APP_ORIGIN/);
  process.env.APP_ORIGIN = 'http://example.org';
  expect(() => registrationUrl(generateToken())).toThrow(/HTTPS/);
});

it('streams a ZIP that can be extracted with intact PNG data', async () => {
  process.env.APP_ORIGIN = 'https://farlands.example.org';
  process.env.QR_ENCRYPTION_KEY = 'ab'.repeat(32);
  const stream = await qrArchiveStream([
    { serial_number: 'FARL-QR-10000', encrypted_token: encryptToken(generateToken()) },
  ]);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const zip = await JSZip.loadAsync(Buffer.concat(chunks), { checkCRC32: true });
  expect(
    (await sharp(await zip.file('FARL-QR-10000.png')!.async('nodebuffer')).metadata()).height,
  ).toBe(900);
});
