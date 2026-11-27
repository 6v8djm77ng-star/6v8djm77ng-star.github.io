import { AppError } from './errors.js';

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/**
 * Decodes a base64 image and validates it by its real bytes (not the declared type).
 * Only JPEG/PNG/WebP up to 3 MB are accepted.
 */
export function decodePhoto(base64: string): { mime: string; data: Buffer } {
  const clean = base64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw new AppError('VALIDATION', 'קובץ התמונה לא תקין');
  const data = Buffer.from(clean, 'base64');
  if (data.length === 0) throw new AppError('VALIDATION', 'קובץ התמונה ריק');
  if (data.length > MAX_PHOTO_BYTES) throw new AppError('VALIDATION', 'התמונה גדולה מדי (עד 3MB)');
  const sig = SIGNATURES.find((s) => s.test(data));
  if (!sig) throw new AppError('VALIDATION', 'אפשר לצרף רק תמונה (JPEG, PNG או WebP)');
  return { mime: sig.mime, data };
}
