import { RawDataDocumentSchema, KafkaMessageSchema } from "../schemas";
import { validateOrThrow } from "./validation";
import { config } from "./config";
import { KafkaService } from "../services/connections/kafkaService";
import { FileInfo } from "../types";

export function extractFileType(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "unknown";
}

export function buildS3Document(fileInfo: FileInfo, fileBase64: string, metadata: Record<string, unknown>) {
  const doc = {
    origin_id: fileInfo.id,
    source_name: config.sourceName,
    insertion_time: new Date().toISOString(),
    original_file_type: extractFileType(fileInfo.name),
    reality: "אמת",
    image_base64: fileBase64,
    metadata: metadata || {},
  };

  return validateOrThrow(RawDataDocumentSchema, doc) as Record<string, unknown>;
}

export function buildKafkaMessage(requestId: string, fileId: string, s3Key: string) {
  const message = {
    source: config.sourceName,
    path: s3Key,
    bucket: config.s3.bucketName,
    message: `File ${fileId} processed and saved to S3`,
    request_id: requestId,
  };

  return validateOrThrow(KafkaMessageSchema, message) as Record<string, unknown>;
}

export async function publishToKafka(message: Record<string, unknown>, requestId: string): Promise<void> {
  await KafkaService.getInstance().publish(message, requestId);
}
