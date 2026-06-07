// Entrypoint: start Kafka worker, register shutdown. No HTTP.
// Config errors → CONFIG_VALIDATION_FAILED (config.ts). Bootstrap errors → BOOTSTRAP_FAILED (below).

import { config } from './config.js';   // validates env at import
import { logger } from './logger.js';
import { kafka } from './kafka.js';
import { db } from './db.js';
import { Pipeline } from './pipeline.js';

// NODE_TLS_REJECT_UNAUTHORIZED='0' must come from env (Dockerfile/k8s), not code —
// imports above already construct s3/db/kafka clients.
const shutdown = async (signal: string): Promise<void> => {
  logger.info('shutting down', { signal });
  await kafka.disconnect();
  await db.closeDb();
  process.exit(0);
};

const main = async (): Promise<void> => {
  const pipeline = new Pipeline();
  await kafka.run((value, requestId) => pipeline.processMessage(value, requestId));
  logger.info('wall-e-ingestor is alive', { environment: config.environment }); // Splunk literal — do not change
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));
};

main().catch((error: unknown) => {
  const { name, message, stack } = error instanceof Error ? error : new Error(String(error));
  logger.error('BOOTSTRAP_FAILED', { error_class: name, error_message: message, stack });
  process.exit(1);
});
