// Nine-stage ingestion pipeline.

import { v7 as uuidv7 } from 'uuid';

import { s3 } from './s3.js';
import { db } from './db.js';
import { kafka } from './kafka.js';
import { deriveObjectKey, imageConverter } from './image.js';
import {
  EnvelopeSchema,
  NormalizedPayloadSchema,
  type AssetRow,
  type DownstreamMessage,
  type Envelope,
  type NormalizedPayload,
} from './schemas.js';
import {
  OrphanWebpError,
  PermanentPipelineError,
  TransientError,
  errorMessage,
} from './errors.js';
import { config } from './config.js';
import { logger, type Logger } from './logger.js';

/** WebP object written to the assets bucket before DB insert. */
type StoredWebpAsset = {
  assetId: string;
  insertionTime: Date;
  bucket: string;
  objectKey: string;
};

const formatZodIssues = (zodError: { issues: Array<{ path: (string | number)[]; message: string }> }): string =>
  zodError.issues
    .map(({ path, message }) => (path.join('.') || '<root>') + ': ' + message)
    .join('; ');

const permanentPipelineError = (message: string, ingestionStage: string): PermanentPipelineError =>
  new PermanentPipelineError(message, ingestionStage);

const errorClassFrom = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';

// Stage 1–2 (P): parse + validate envelope.
const parseEnvelope = (kafkaMessageValue: string): Envelope => {
  const parsedKafkaMessage: unknown = JSON.parse(kafkaMessageValue);
  const { success, data, error } = EnvelopeSchema.safeParse(parsedKafkaMessage);
  if (!success) {
    throw permanentPipelineError(formatZodIssues(error), 'envelope_validate');
  }
  return data;
};

// Stage 3 (T): fetch source payload JSON from the path named in the envelope.
const fetchSourcePayloadFromS3 = async ({ bucket, path }: Envelope) => await s3.getJson(bucket, path);

// Stage 4 (P): validate source payload; cross-check source matches envelope.
const validateNormalizedPayload = (
  sourcePayloadDocument: unknown,
  envelope: Envelope,
): NormalizedPayload => {
  const { success, data: normalizedPayload, error } = NormalizedPayloadSchema.safeParse(sourcePayloadDocument);
  if (!success) {
    throw permanentPipelineError('S3 payload failed Zod validation: ' + formatZodIssues(error), 'payload_validate');
  }
  const { source: normalizedSource } = normalizedPayload;
  const { source: envelopeSource } = envelope;
  if (normalizedSource !== envelopeSource) {
    throw permanentPipelineError(
      `envelope.source ${envelopeSource} != payload.source ${normalizedSource}`,
      'payload_validate',
    );
  }
  return normalizedPayload;
};

// Stages 5–6 (P): decode base64 and convert to WebP (per-source defaults).
const convertNormalizedImageToWebp = async ({ base64, source }: NormalizedPayload) =>
  imageConverter.convertForSource(source, base64);

// Stage 7 (T): mint asset id, derive key, upload WebP.
const storeWebpInS3 = async (
// the insertion time is the default for the s3 insetion, but sometimes we will want to run backfill for a source,
// for backfills, we will want to use a different insertion time, for example the capture time of the image
// this is on a per-source basis, each source has its own time that we will want to use for backfill,
// the adapter will provide an "is_backfill" boolean field, and we will have a dict with a backfill_time for each source,
// and if the is_backfill is true, we will use the backfill_time for the insertion time, otherwise we will use the default insertion time
  webpImageBuffer: Buffer,
  sourceName: NormalizedPayload['source'],
): Promise<StoredWebpAsset> => {
  const assetId = uuidv7();
  const insertionTime = new Date();
  const bucket = config.s3BucketName;
  const objectKey = deriveObjectKey(sourceName, assetId, insertionTime); // the insertion time is the defa
  await s3.putWebp(webpImageBuffer, bucket, objectKey);
  return { assetId, insertionTime, bucket, objectKey };
};

const toAssetRow = (
  { assetId, insertionTime }: StoredWebpAsset,
  { source, origin_id, reality, metadata }: NormalizedPayload,
): AssetRow => ({
  id: assetId,
  source_name: source,
  origin_id,
  insertion_time: insertionTime,
  reality,
  metadata,
});

// Stage 8 (T): insert DB row. Orphan (S3 ok, DB fail) → OrphanWebpError at catch site.
const persistAssetRow = async (
  storedWebp: StoredWebpAsset,
  normalizedPayload: NormalizedPayload,
  envelope: Envelope,
): Promise<void> => {
  try {
    await db.insertAsset(toAssetRow(storedWebp, normalizedPayload));
  } catch (dbError) {
    const { bucket, objectKey, assetId } = storedWebp;
    const { source } = normalizedPayload;
    const { request_id } = envelope;
    throw new OrphanWebpError(bucket, objectKey, assetId, source, request_id, dbError);
  }
};

const toDownstreamMessage = (
  { assetId, insertionTime }: StoredWebpAsset,
  { source, origin_id, reality, metadata }: NormalizedPayload,
  requestId: string,
): DownstreamMessage => ({
  id: assetId,
  source,
  origin_id,
  reality: reality ?? '',
  metadata,
  insertion_time: insertionTime.getTime(),
  request_id: requestId,
  schema_version: 1,
});

// Stage 9 (T): publish downstream Kafka message.
const publishDownstreamEvent = async (
  storedWebp: StoredWebpAsset,
  normalizedPayload: NormalizedPayload,
  { request_id }: Envelope,
): Promise<void> => {
  await kafka.publish(toDownstreamMessage(storedWebp, normalizedPayload, request_id), request_id);
};

const logPermanentFailure = (
  log: Logger,
  error: unknown,
  ingestionStage: string,
  storedWebpBucket: string | null,
  storedWebpKey: string | null,
): void => {
  log.error('envelope failed', {
    ingestion_stage: ingestionStage,
    error_class: errorClassFrom(error),
    error_message: errorMessage(error),
    s3_bucket: storedWebpBucket,
    s3_key: storedWebpKey,
  });
};

const logOrphanWebp = (
  log: Logger,
  {
    orphanS3Bucket,
    orphanS3Key,
    assetId,
    source,
    requestId,
    dbError,
  }: OrphanWebpError,
): void => {
  log.error('pixar_orphan_webp', {
    event: 'pixar_orphan_webp',
    orphan_s3_bucket: orphanS3Bucket,
    orphan_s3_key: orphanS3Key,
    asset_id: assetId,
    source,
    request_id: requestId,
    original_db_error_class: errorClassFrom(dbError),
    original_db_error_message: errorMessage(dbError),
  });
};

export class Pipeline {
  /** Nine stages. Return = commit offset; TransientError = redeliver. Never throw plain Error. */
  async processMessage(kafkaMessageValue: string, inboundRequestId: string): Promise<void> {
    const requestLogger = logger.child({ request_id: inboundRequestId });
    let envelopeLogger: Logger = requestLogger;
    let storedWebpBucket: string | null = null;
    let storedWebpKey: string | null = null;
    let stage = 'envelope_parse';

    try {
      const envelope = parseEnvelope(kafkaMessageValue);
      const { request_id, source, bucket, path, message } = envelope;

      envelopeLogger = requestLogger.child({ request_id, source });
      envelopeLogger.info('envelope accepted', { bucket, path, message });

      stage = 'payload_fetch';
      const sourcePayloadDocument = await fetchSourcePayloadFromS3(envelope);
      stage = 'payload_validate';
      const normalizedPayload = validateNormalizedPayload(sourcePayloadDocument, envelope);
      stage = 'image_convert';
      const webpImageBuffer = await convertNormalizedImageToWebp(normalizedPayload);
      stage = 's3_upload';
      const storedWebp = await storeWebpInS3(webpImageBuffer, normalizedPayload.source);
      const { bucket: webpBucket, objectKey: webpKey, assetId } = storedWebp;
      storedWebpBucket = webpBucket;
      storedWebpKey = webpKey;

      stage = 'db_insert';
      await persistAssetRow(storedWebp, normalizedPayload, envelope);
      stage = 'kafka_publish';
      await publishDownstreamEvent(storedWebp, normalizedPayload, envelope);

      envelopeLogger.info('envelope processed', {
        asset_id: assetId,
        source: normalizedPayload.source,
        s3_bucket: webpBucket,
        s3_key: webpKey,
      });
    } catch (error) {
      if (error instanceof TransientError) throw error;
      if (error instanceof OrphanWebpError) {
        logOrphanWebp(envelopeLogger, error);
        return;
      }
      const ingestionStage =
        error instanceof PermanentPipelineError ? error.ingestionStage : stage;
      logPermanentFailure(envelopeLogger, error, ingestionStage, storedWebpBucket, storedWebpKey);
    }
  }
}
