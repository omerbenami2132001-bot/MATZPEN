// Error model: TransientError marker + S3/Kafka/Pg classifiers.
// S3/Pg default unknown→permanent; Kafka defaults unknown→transient.

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Marker for retryable failures; plain Error = permanent.
export class TransientError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'TransientError';
    Object.setPrototypeOf(this, TransientError.prototype);
  }
}

/** Permanent pipeline failure with Splunk stage label — log at processMessage catch. */
export class PermanentPipelineError extends Error {
  constructor(message: string, public readonly ingestionStage: string) {
    super(message);
    this.name = 'PermanentPipelineError';
    Object.setPrototypeOf(this, PermanentPipelineError.prototype);
  }
}

/** S3 upload succeeded; DB insert failed — handled at processMessage catch. */
export class OrphanWebpError extends Error {
  constructor(
    public readonly orphanS3Bucket: string,
    public readonly orphanS3Key: string,
    public readonly assetId: string,
    public readonly source: string,
    public readonly requestId: string,
    public readonly dbError: unknown,
  ) {
    super('pixar_orphan_webp');
    this.name = 'OrphanWebpError';
    Object.setPrototypeOf(this, OrphanWebpError.prototype);
  }
}

// Unknown → permanent.
const S3_TRANSIENT_NAMES = new Set([
  'TimeoutError', 'RequestTimeout', 'ThrottlingException', 'Throttling', 'SlowDown',
]);
const S3_TRANSIENT_CAUSE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN',
]);

export function isTransientS3Error(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;

  // $metadata.httpStatusCode, then top-level httpStatusCode.
  const awsMetadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  const httpStatus =
    awsMetadata !== undefined && typeof awsMetadata.httpStatusCode === 'number'
      ? awsMetadata.httpStatusCode
      : typeof (error as { httpStatusCode?: unknown }).httpStatusCode === 'number'
        ? (error as { httpStatusCode: number }).httpStatusCode
        : undefined;

  if (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599) return true;

  const name = typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : '';
  if (S3_TRANSIENT_NAMES.has(name)) return true;

  // cause.code, then top-level code.
  const cause = (error as { cause?: unknown }).cause;
  const code =
    cause !== null && cause !== undefined && typeof cause === 'object' &&
    typeof (cause as { code?: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
  if (code !== undefined && S3_TRANSIENT_CAUSE_CODES.has(code)) return true;

  return false;
}

// Check NonRetriableError first (parent class). Unknown → transient.
const KAFKA_RETRIABLE_PROTOCOL = new Set([
  'REQUEST_TIMED_OUT', 'NETWORK_EXCEPTION', 'NOT_ENOUGH_REPLICAS',
  'NOT_ENOUGH_REPLICAS_AFTER_APPEND', 'LEADER_NOT_AVAILABLE',
  'NOT_LEADER_FOR_PARTITION', 'KAFKA_STORAGE_ERROR', 'BROKER_NOT_AVAILABLE',
]);
const KAFKA_FATAL_PROTOCOL = new Set([
  'UNSUPPORTED_VERSION', 'INVALID_TOPIC_EXCEPTION', 'TOPIC_AUTHORIZATION_FAILED',
  'GROUP_AUTHORIZATION_FAILED', 'CLUSTER_AUTHORIZATION_FAILED',
  'INVALID_CONFIG', 'POLICY_VIOLATION',
]);

const kafkaErrorName = (error: unknown): string =>
  error instanceof Error ? error.name : '';

export function isTransientKafkaError(error: unknown): boolean {
  const name = kafkaErrorName(error);
  if (name === 'KafkaJSNonRetriableError') return false;
  if (name === 'KafkaJSConnectionError') return true;
  if (name === 'KafkaJSNumberOfRetriesExceeded') return true;
  if (name === 'KafkaJSProtocolError') {
    const type =
      error !== null && typeof error === 'object' && typeof (error as { type?: unknown }).type === 'string'
        ? (error as { type: string }).type
        : '';
    if (KAFKA_RETRIABLE_PROTOCOL.has(type)) return true;
    if (KAFKA_FATAL_PROTOCOL.has(type)) return false;
    return true;
  }
  if (error !== null && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return true;
  }
  return true;
}

// SQLSTATE 08xxx + pre-connect socket codes → transient; else permanent.
const PG_TRANSIENT_SOCKET_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN',
]);

export function isTransientPgError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  if (code.startsWith('08')) return true;
  return PG_TRANSIENT_SOCKET_CODES.has(code);
}
