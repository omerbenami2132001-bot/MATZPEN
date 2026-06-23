import { Kafka, Producer } from "kafkajs";
import * as logger from "../../utils/logger";
import { STEPS } from "../../utils/logger";
import { config } from "../../utils/config";
import { withRetry } from "../../utils/retry";

export class KafkaService {
  private static instance: KafkaService;
  private producer: Producer | null = null;
  private connected = false;
  private topic: string;

  private constructor() {
    this.topic = config.kafka.topic;
  }

  static getInstance(): KafkaService {
    if (!KafkaService.instance) {
      KafkaService.instance = new KafkaService();
    }
    return KafkaService.instance;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const brokers = config.kafka.brokers;
    const cert = config.kafka.cert;
    const key = config.kafka.key;

    if (!brokers) {
      logger.log("WARN", "system", STEPS.KAFKA_PRODUCE, "KAFKA_PRODUCER_BROKERS_FLIX not set, Kafka disabled");
      return;
    }

    const kafkaConfig: any = {
      clientId: "adapter-service",
      brokers: brokers.split(","),
    };

    if (cert && key) {
      kafkaConfig.ssl = {
        cert,
        key,
        rejectUnauthorized: false,
      };
    }

    const kafka = new Kafka(kafkaConfig);
    this.producer = kafka.producer({
      idempotent: true,
    });
    await this.producer.connect();
    this.connected = true;

    logger.log("INFO", "system", STEPS.KAFKA_PRODUCE, "Kafka producer connected", {
      brokers: kafkaConfig.brokers, topic: this.topic, ssl: !!(cert && key),
    });
  }

  async publish(message: Record<string, unknown>, requestId: string): Promise<void> {
    if (!this.connected || !this.producer) {
      logger.log("INFO", requestId, STEPS.KAFKA_PRODUCE, "Kafka not connected, logging message", {
        topic: this.topic, message,
      });
      return;
    }

    await withRetry(
      () => this.producer!.send({
        topic: this.topic,
        messages: [{ value: JSON.stringify(message) }],
      }),
      { retries: 3, delayMs: 1000, label: "kafka publish", requestId }
    );

    logger.log("INFO", requestId, STEPS.KAFKA_PRODUCE, "Message published to Kafka", {
      topic: this.topic,
      source: message.source,
      path: message.path,
      bucket: message.bucket,
    });
  }

  async disconnect(): Promise<void> {
    if (this.producer && this.connected) {
      await this.producer.disconnect();
      this.connected = false;
      logger.log("INFO", "system", STEPS.KAFKA_PRODUCE, "Kafka producer disconnected");
    }
  }
}
