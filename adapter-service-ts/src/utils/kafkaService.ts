import { Kafka, Producer } from "kafkajs";
import fs from "fs";
import * as logger from "./logger";
import { STEPS } from "./logger";
import { KAFKA_TOPIC } from "./constants";
import { withRetry } from "./retry";

export class KafkaService {
  private producer: Producer | null = null;
  private connected = false;
  private topic: string;

  constructor() {
    this.topic = KAFKA_TOPIC;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const brokers = process.env.KAFKA_PRODUCER_BROKERS;
    const certPath = process.env.KAFKA_CERT;
    const keyPath = process.env.KAFKA_KEY;

    if (!brokers) {
      logger.log("WARN", "system", STEPS.KAFKA_PRODUCE, "KAFKA_PRODUCER_BROKERS not set, Kafka disabled");
      return;
    }

    const kafkaConfig: any = {
      clientId: "adapter-service",
      brokers: brokers.split(","),
    };

    if (certPath && keyPath) {
      kafkaConfig.ssl = {
        cert: fs.readFileSync(certPath, "utf-8"),
        key: fs.readFileSync(keyPath, "utf-8"),
        rejectUnauthorized: false,
      };
    }

    const kafka = new Kafka(kafkaConfig);
    this.producer = kafka.producer();
    await this.producer.connect();
    this.connected = true;

    logger.log("INFO", "system", STEPS.KAFKA_PRODUCE, "Kafka producer connected", {
      brokers: kafkaConfig.brokers, topic: this.topic, ssl: !!(certPath && keyPath),
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

export const kafkaService = new KafkaService();
