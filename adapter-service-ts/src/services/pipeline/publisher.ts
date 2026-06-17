// Publisher — בונה document, שומר ל-S3, ושולח message ל-Kafka.
import * as logger from "../../utils/logger";
import { STEPS } from "../../utils/logger";
import { buildS3Document, buildKafkaMessage, publishToKafka } from "../../utils/eventBuilder";
import { S3Service } from "../connections/s3Client";
import { FileInfo } from "../../types";

export class Publisher {
  private s3Service: S3Service;

  constructor(s3Service: S3Service) {
    this.s3Service = s3Service;
  }

  async publish(fileInfo: FileInfo, base64: string, metadata: Record<string, unknown>, requestId: string) {
    logger.log("INFO", requestId, STEPS.BUILD_S3_DOC, "Building S3 document", {
      fileId: fileInfo.id, metadataFields: Object.keys(metadata).length
    });
    const s3Document = buildS3Document(fileInfo, base64, metadata);

    const s3Key = await this.s3Service.save(s3Document, fileInfo.name, requestId);

    logger.log("INFO", requestId, STEPS.BUILD_KAFKA_MSG, "Building Kafka message", {
      fileId: fileInfo.id, s3Key
    });
    const kafkaMessage = buildKafkaMessage(requestId, fileInfo.id, s3Key);

    await publishToKafka(kafkaMessage, requestId);

    return s3Key;
  }
}
