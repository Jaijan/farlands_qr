import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const generateToken = () => randomBytes(32).toString('base64url');
function key() {
  const value = process.env.QR_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('QR encryption key is not configured.');
  return Buffer.from(value, 'hex');
}
export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
export function decryptToken(value: string) {
  const b = Buffer.from(value, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
