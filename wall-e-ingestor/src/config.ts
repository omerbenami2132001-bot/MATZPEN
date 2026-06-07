// Zod env validation at import; failure → CONFIG_VALIDATION_FAILED + exit(1).

import * as fs from 'node:fs';
import { z } from 'zod';

// k8s Secret mount: /app/certs/db.crt + db.key (closed-network convention)
const DB_CERT_FILE = '/app/certs/db.crt';
const DB_KEY_FILE = '/app/certs/db.key';

// Non-empty JSON array of "host:port" strings (Kafka broker lists).
const brokerListString = z.string().refine(
  (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return false;
      return parsed.every(
        (broker) => typeof broker === 'string' && /^[a-z0-9.-]+:\d+$/i.test(broker),
      );
    } catch {
      return false;
    }
  },
  { message: 'must be a non-empty JSON array of "host:port" strings' },
);

const EnvSchema = z
  .object({
    // --- App ---
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    ENVIRONMENT: z.enum(['local', 'np', 'pp', 'prod']),
    NODE_TLS_REJECT_UNAUTHORIZED: z.literal('0'),

    // --- Logging ---
    // Keep 'notice' — LOG_LEVEL=notice must not crash; logger maps it to info rank.
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'notice', 'debug']).default('info'),

    // --- DB ---
    DATABASE_URL: z.string().min(1),
    // Optional here; superRefine loads from mounted files in pp/prod.
    DB_CERT: z.string().optional(),
    DB_KEY: z.string().optional(),

    // --- S3 ---
    S3_ENDPOINT: z.string().url(),
    // Case-sensitive (Acme-Cloud-1) — lowercase causes SignatureDoesNotMatch.
    S3_REGION: z.string().min(1),
    S3_BUCKET_NAME: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
    S3_BUCKET_ACL: z.enum(['private', 'public-read']).default('private'),

    // --- Image ---
    IMAGE_QUALITY: z.coerce.number().int().min(1).max(100).default(75),
    IMAGE_TIMEZONE: z.string().min(1).default('Asia/Jerusalem'),

    // --- Kafka inbound ---
    KAFKA_INBOUND_BROKERS: brokerListString,
    KAFKA_INBOUND_TOPIC: z.string().min(1),
    KAFKA_INBOUND_GROUP_ID: z.string().min(1),
    KAFKA_INBOUND_CERT: z.string().min(1),
    KAFKA_INBOUND_KEY: z.string().min(1),
    KAFKA_INBOUND_MAX_MEGABYTES: z.coerce.number().int().min(1).default(10),
    KAFKA_INBOUND_MAX_WAIT_MS: z.coerce.number().int().min(0).default(500),
    KAFKA_INBOUND_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(3),
    KAFKA_INBOUND_SESSION_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(30),

    // --- Kafka producer ---
    KAFKA_PRODUCER_BROKERS: brokerListString,
    KAFKA_DOWNSTREAM_TOPIC: z.string().min(1),
    // min(1): idempotent KafkaJS producer rejects retries < 1.
    KAFKA_PRODUCER_MAX_RETRY_COUNT: z.coerce.number().int().min(1).default(5),
    KAFKA_PRODUCER_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(300),
  })
  .superRefine((envVars, context) => {
    // pp/prod: require mTLS PEM from env or mounted Secret files.
    if (envVars.ENVIRONMENT === 'pp' || envVars.ENVIRONMENT === 'prod') {
      if (!envVars.DB_CERT) {
        try {
          envVars.DB_CERT = fs.readFileSync(DB_CERT_FILE, 'utf-8');
        } catch (readError) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DB_CERT'],
            message: `DB_CERT not set and ${DB_CERT_FILE} not readable: ${(readError as Error).message}`,
          });
        }
      }
      if (!envVars.DB_KEY) {
        try {
          envVars.DB_KEY = fs.readFileSync(DB_KEY_FILE, 'utf-8');
        } catch (readError) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DB_KEY'],
            message: `DB_KEY not set and ${DB_KEY_FILE} not readable: ${(readError as Error).message}`,
          });
        }
      }
    }
  });

export type DbConfig =
  | { readonly url: string; readonly tls: { readonly mode: 'password' } }
  | {
      readonly url: string;
      readonly tls: { readonly mode: 'mtls'; readonly cert: string; readonly key: string };
    };

export type KafkaInbound = Readonly<{
  brokers: readonly string[];
  topic: string;
  groupId: string;
  cert: string;
  key: string;
  maxMegabytes: number;
  maxWaitMs: number;
  heartbeatIntervalSeconds: number;
  sessionTimeoutSeconds: number;
}>;

export type KafkaProducer = Readonly<{
  brokers: readonly string[];
  downstreamTopic: string;
  maxRetryCount: number;
  retryDelayMs: number;
}>;

export type Config = Readonly<{
  nodeEnv: 'development' | 'production' | 'test';
  environment: 'local' | 'np' | 'pp' | 'prod';
  logLevel: 'error' | 'warn' | 'info' | 'notice' | 'debug';
  imageQuality: number;
  imageTimezone: string;
  s3Endpoint: string;
  s3Region: string;
  s3BucketName: string;
  s3MaxAttempts: number;
  s3Acl: 'private' | 'public-read';
  // Fresh object per call — AWS SDK v3 mutates creds with $source.
  s3Credentials: () => Promise<{ accessKeyId: string; secretAccessKey: string }>;
  kafkaInbound: KafkaInbound;
  kafkaProducer: KafkaProducer;
  dbConfig: DbConfig;
}>;

// Test seam — throws on bad env, never process.exit.
export function parseConfig(
  processEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Config {
  const { success, data: envVars, error } = EnvSchema.safeParse(processEnv);
  if (!success) {
    const detail = error.issues
      .map(({ path, message }) => `  - ${path.join('.') || '(root)'}: ${message}`)
      .join('\n');
    throw new Error(`CONFIG_VALIDATION_FAILED\n${detail}`);
  }
  const usesMtls = envVars.ENVIRONMENT === 'pp' || envVars.ENVIRONMENT === 'prod';

  // Locals for s3Credentials closure — never share one object across calls.
  const accessKeyId = envVars.S3_ACCESS_KEY_ID;
  const secretAccessKey = envVars.S3_SECRET_ACCESS_KEY;

  return Object.freeze({
    nodeEnv: envVars.NODE_ENV,
    environment: envVars.ENVIRONMENT,
    logLevel: envVars.LOG_LEVEL,
    imageQuality: envVars.IMAGE_QUALITY,
    imageTimezone: envVars.IMAGE_TIMEZONE,
    s3Endpoint: envVars.S3_ENDPOINT,
    s3Region: envVars.S3_REGION,
    s3BucketName: envVars.S3_BUCKET_NAME,
    s3MaxAttempts: envVars.S3_MAX_ATTEMPTS,
    s3Acl: envVars.S3_BUCKET_ACL,
    s3Credentials: async () => ({ accessKeyId, secretAccessKey }),
    kafkaInbound: Object.freeze({
      brokers: Object.freeze(JSON.parse(envVars.KAFKA_INBOUND_BROKERS) as string[]),
      topic: envVars.KAFKA_INBOUND_TOPIC,
      groupId: envVars.KAFKA_INBOUND_GROUP_ID,
      cert: envVars.KAFKA_INBOUND_CERT,
      key: envVars.KAFKA_INBOUND_KEY,
      maxMegabytes: envVars.KAFKA_INBOUND_MAX_MEGABYTES,
      maxWaitMs: envVars.KAFKA_INBOUND_MAX_WAIT_MS,
      heartbeatIntervalSeconds: envVars.KAFKA_INBOUND_HEARTBEAT_INTERVAL_SECONDS,
      sessionTimeoutSeconds: envVars.KAFKA_INBOUND_SESSION_TIMEOUT_SECONDS,
    }),
    kafkaProducer: Object.freeze({
      brokers: Object.freeze(JSON.parse(envVars.KAFKA_PRODUCER_BROKERS) as string[]),
      downstreamTopic: envVars.KAFKA_DOWNSTREAM_TOPIC,
      maxRetryCount: envVars.KAFKA_PRODUCER_MAX_RETRY_COUNT,
      retryDelayMs: envVars.KAFKA_PRODUCER_RETRY_DELAY_MS,
    }),
    dbConfig: usesMtls
      ? {
          url: envVars.DATABASE_URL,
          tls: {
            mode: 'mtls' as const,
            cert: envVars.DB_CERT ?? '',
            key: envVars.DB_KEY ?? '',
          },
        }
      : { url: envVars.DATABASE_URL, tls: { mode: 'password' as const } },
  });
}

// Runs at import; emits raw JSON (logger not ready yet).
function loadConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        service: 'wall-e-ingestor',
        message: 'CONFIG_VALIDATION_FAILED',
        issues: (error as Error).message,
      }),
    );
    process.exit(1);
  }
}

export const config: Config = Object.freeze(loadConfig());
