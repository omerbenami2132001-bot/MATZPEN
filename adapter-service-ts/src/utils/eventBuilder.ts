import { RawDataDocumentSchema, KafkaMessageSchema } from "../schemas";
import { validateOrThrow } from "./validation";
import { config } from "./config";
import { KafkaService } from "../services/connections/kafkaService";

export function extractFileType(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "unknown";
}

interface FileInfo {
  id: string;
  name: string;
  [key: string]: unknown;
}

export function buildS3Document({ fileInfo, fileBase64, metadata }: { fileInfo: FileInfo; fileBase64: string; metadata: Record<string, unknown> }): Record<string, unknown> {
  const doc = {
    origin_id: fileInfo.id,
    source_name: config.sourceName,
    insertion_time: new Date().toISOString(),
    original_file_type: extractFileType(fileInfo.name),
    reality: "אמת",
    image_base64: fileBase64,
    metadata: metadata || {},
  };

  return validateOrThrow(RawDataDocumentSchema, doc) as unknown as Record<string, unknown>;
}

export function buildKafkaMessage({ requestId, fileId, s3Key }: { requestId: string; fileId: string; s3Key: string }): Record<string, unknown> {
  const message = {
    source: config.sourceName,
    path: s3Key,
    bucket: config.s3.bucketName,
    message: `File ${fileId} processed and saved to S3`,
    request_id: requestId,
  };

  return validateOrThrow(KafkaMessageSchema, message) as unknown as Record<string, unknown>;
}

export async function publishToKafka(message: Record<string, unknown>, requestId: string): Promise<void> {
  await KafkaService.getInstance().publish(message, requestId);
}
