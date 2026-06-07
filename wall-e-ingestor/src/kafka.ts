// Kafka consumer + downstream producer singleton.

import { Kafka, type Consumer, type Producer, type EachBatchPayload, type IHeaders } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { TransientError, isTransientKafkaError, errorMessage } from './errors.js';
import type { DownstreamMessage } from './schemas.js';
import { logger } from './logger.js';

// Four mandatory headers on every produced message. correlation-id = envelope request_id.
const HEADER_CORRELATION_ID = 'correlation-id';
const HEADER_PRODUCED_BY    = 'produced-by';
const HEADER_PRODUCED_AT    = 'produced-at';
const HEADER_SCHEMA_VERSION = 'schema-version';

function buildHeaders(requestId: string): IHeaders {
  return {
    [HEADER_CORRELATION_ID]: requestId,
    [HEADER_PRODUCED_BY]:    'wall-e-ingestor',
    [HEADER_PRODUCED_AT]:    String(Date.now()),
    [HEADER_SCHEMA_VERSION]: '1',
  };
}

function readCorrelationId(headers: IHeaders | undefined): string | undefined {
  const headerValue = headers?.[HEADER_CORRELATION_ID];
  if (headerValue === undefined) return undefined;
  return Buffer.isBuffer(headerValue) ? headerValue.toString('utf8') : Array.isArray(headerValue) ? undefined : String(headerValue);
}

// Two clients (inbound + producer), distinct clientIds for broker ACLs, shared PEM.
// Kafka_ suffix avoids clash with imported Kafka class.
// Handler is called bare — TransientError skips offset commit.
class Kafka_ {
  private readonly inboundClient = new Kafka({
    clientId: 'wall-e-ingestor',
    brokers: [...config.kafkaInbound.brokers],
    ssl: { cert: config.kafkaInbound.cert, key: config.kafkaInbound.key },
    retry: { retries: 3, maxRetryTime: 10_000 },
  });

  private readonly producerClient = new Kafka({
    clientId: 'wall-e-ingestor-producer',
    brokers: [...config.kafkaProducer.brokers],
    ssl: { cert: config.kafkaInbound.cert, key: config.kafkaInbound.key },
    retry: { retries: 3, maxRetryTime: 10_000 },
  });

  private consumer: Consumer | null = null;
  private producer: Producer | null = null;

  async run(handler: (value: string, requestId: string) => Promise<void>): Promise<void> {
    this.producer = this.producerClient.producer({
      idempotent: true,
      retry: {
        retries: config.kafkaProducer.maxRetryCount,     // idempotent producer requires >0
        initialRetryTime: config.kafkaProducer.retryDelayMs,
      },
    });
    await this.producer.connect();

    // Configmap values are s/MB; KafkaJS expects ms/bytes.
    this.consumer = this.inboundClient.consumer({
      groupId:            config.kafkaInbound.groupId,
      heartbeatInterval:  config.kafkaInbound.heartbeatIntervalSeconds * 1000,
      sessionTimeout:     config.kafkaInbound.sessionTimeoutSeconds    * 1000,
      maxBytes:           config.kafkaInbound.maxMegabytes * 1024 * 1024,
      maxWaitTimeInMs:    config.kafkaInbound.maxWaitMs,
    });

    // Log KafkaJS crash events — fatal vs retriable.
    const { CRASH } = this.consumer.events;
    this.consumer.on(CRASH, ({ payload: { error: crashError } }) => {
      const crashMessage = crashError instanceof Error ? crashError.message : String(crashError);
      logger.error(
        crashError instanceof Error && crashError.name === 'KafkaJSNonRetriableError'
          ? `kafka non-retriable crash: ${crashMessage}`
          : `kafka crash, will retry: ${crashMessage}`,
      );
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [config.kafkaInbound.topic], fromBeginning: false });

    await this.consumer.run({
      eachBatchAutoResolve: false, // manual resolveOffset per message
      eachBatch: async ({
        batch,
        resolveOffset,
        heartbeat,
        commitOffsetsIfNecessary,
        isRunning,
        isStale,
      }: EachBatchPayload) => {
        if (batch.messages.length === 0) { logger.warn('empty batch'); return; }

        for (const message of batch.messages) {
          if (!isRunning() || isStale()) break;

          const value = message.value !== null ? message.value.toString('utf8') : '';
          const requestId = readCorrelationId(message.headers) ?? randomUUID();

          await handler(value, requestId);

          resolveOffset(message.offset);
          await heartbeat();
        }

        await commitOffsetsIfNecessary();
      },
    });
  }

  async publish(message: DownstreamMessage, requestId: string): Promise<void> {
    if (this.producer === null) throw new TransientError('producer not initialised');
    try {
      await this.producer.send({
        topic: config.kafkaProducer.downstreamTopic,
        messages: [{ value: JSON.stringify(message), headers: buildHeaders(requestId) }],
      });
    } catch (error) {
      if (isTransientKafkaError(error)) throw new TransientError('downstream publish failed', { cause: errorMessage(error) });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  // Consumer first (settle in-flight batch), then producer.
  async disconnect(): Promise<void> {
    try {
      if (this.consumer) await this.consumer.disconnect();
    } catch (error) {
      logger.warn(`consumer disconnect error: ${String(error)}`);
    }
    try {
      if (this.producer) await this.producer.disconnect();
    } catch (error) {
      logger.warn(`producer disconnect error: ${String(error)}`);
    }
  }
}

export const kafka = new Kafka_();
