// Image helpers: base64→WebP and time-partitioned S3 keys.

import sharp from 'sharp';

import { config } from './config.js';
import { SOURCE_NAMES, type SourceName } from './schemas.js';

const DATA_URL_PREFIX_REGEX = /^data:image\/[a-z0-9.+-]+;base64,/i;

export type WebpConvertOptions = { quality: number };

/** Per-source WebP defaults; tune quality per adapter without pipeline branches. */
const SOURCE_WEBP_DEFAULTS: Record<SourceName, WebpConvertOptions> = Object.fromEntries(
  SOURCE_NAMES.map((source) => [source, { quality: config.imageQuality }]),
) as Record<SourceName, WebpConvertOptions>;

/** Sharp-backed encoder; add format methods here as sources need them. */
export class ImageConverter {
  private decodeBase64(base64: string): Buffer {
    const stripped = base64.replace(DATA_URL_PREFIX_REGEX, '');
    const input = Buffer.from(stripped, 'base64');
    if (input.length === 0) {
      throw new Error('decoded base64 buffer is empty');
    }
    return input;
  }

  webpOptionsForSource(source: SourceName): WebpConvertOptions {
    return SOURCE_WEBP_DEFAULTS[source];
  }

  // Empty buffer or sharp errors are permanent (not retried).
  async toWebp(base64: string, { quality }: WebpConvertOptions): Promise<Buffer> {
    const input = this.decodeBase64(base64);
    return await sharp(input).webp({ quality }).toBuffer();
  }

  async convertForSource(source: SourceName, base64: string): Promise<Buffer> {
    return this.toWebp(base64, this.webpOptionsForSource(source));
  }
}

export const imageConverter = new ImageConverter();

// Key: <source>/YYYY/MM/DD/HH/<assetId>.webp in config.imageTimezone.
export function deriveObjectKey(sourceName: string, assetId: string, partitionTime: Date): string {
  const tz = config.imageTimezone;
  const datePartition = partitionTime.toLocaleDateString('en-ZA', { timeZone: tz });
  const hourPartition =
    partitionTime.toLocaleTimeString('en-ZA', { timeZone: tz }).split(':')[0] ?? '00';
  return `${sourceName}/${datePartition}/${hourPartition}/${assetId}.webp`;
}
