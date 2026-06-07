// Zod wire contracts + AssetRow DB type.
import { z } from 'zod';

// Order matches Postgres sources_types enum.
export const SOURCE_NAMES = [
  'cellular_images_report',
  'telegram',
  'cameras',
  'cargo',
] as const satisfies readonly string[];

export type SourceName = (typeof SOURCE_NAMES)[number];

// Inbound Kafka message (5 required fields). .strict() rejects extras.
export const EnvelopeSchema = z.object({
  source:     z.enum(SOURCE_NAMES),
  path:       z.string().min(1, 'envelope.path must be non-empty'),
  bucket:     z.string().min(1, 'envelope.bucket must be non-empty'),
  message:    z.string(),
  request_id: z.string().uuid('envelope.request_id must be a UUID'),
}).strict();

export type Envelope = z.infer<typeof EnvelopeSchema>;

// JSON at {bucket}/{path}. .strict() rejects extras.
export const NormalizedPayloadSchema = z.object({
  origin_id: z.string().min(1, 'payload.origin_id must be non-empty'),
  source:    z.enum(SOURCE_NAMES),
  reality:   z.string(),
  metadata:  z.record(z.string(), z.unknown()).default({}),
  base64:    z.string().min(1, 'payload.base64 must be non-empty'),
}).strict();

export type NormalizedPayload = z.infer<typeof NormalizedPayloadSchema>;

// Downstream Kafka message. insertion_time = unix ms; schema_version = 1.
export const DownstreamMessageSchema = z.object({
  id:             z.string().uuid(),
  source:         z.enum(SOURCE_NAMES),
  origin_id:      z.string().min(1),
  reality:        z.string(),
  metadata:       z.record(z.string(), z.unknown()),
  insertion_time: z.number().int().nonnegative(),
  request_id:     z.string().uuid(),
  schema_version: z.literal(1),
}).strict();

export type DownstreamMessage = z.infer<typeof DownstreamMessageSchema>;

// db.insertAsset input. status/deletion_time set in SQL.
export type AssetRow = {
  id:             string;
  source_name:    SourceName;
  origin_id:      string;
  insertion_time: Date;
  reality:        string | null;
  metadata:       Record<string, unknown>;
};
