// Config
export { config, validateConfig } from "./config";

// Validation
export { validateOrThrow, ValidationError } from "./validation";

// Retry
export { withRetry } from "./retry";

// Event Builder (pure functions)
export { buildS3Document, buildKafkaMessage, publishToKafka } from "./eventBuilder";

// Normalizer (pure functions)
export { normalizeFieldName, isDateLike, toUnixMs, normalizeObject } from "./normalizer";

// Constants
export * from "./constants";

// Logger
export * as logger from "./logger";
export { STEPS } from "./logger";

// Classes (singletons)
export { ApiClient, apiClient } from "./httpClient";
export { S3Service, s3Service } from "./s3Client";
export { KafkaService, kafkaService } from "./kafkaService";
export { MetadataClient, metadataClient } from "./metadataClient";
export { JobStore, jobStore, JOB_STATUS } from "./jobStore";
export type { FileResult, Job } from "./jobStore";

// Classes (static / service)
export { ErrorHandler } from "./errorHandler";
export { AdapterService } from "./adapterService";
