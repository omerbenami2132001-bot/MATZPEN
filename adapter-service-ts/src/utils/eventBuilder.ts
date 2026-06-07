import { S3FileDocumentSchema, KafkaMessageSchema } from "../schemas";
import { validateOrThrow } from "./validation";
import { SOURCE_NAME, S3_BUCKET } from "./constants";
import { kafkaService } from "./kafkaService";

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
    source_name: SOURCE_NAME,
    insertion_time: new Date().toISOString(),
    original_file_type: extractFileType(fileInfo.name),
    image_base64: fileBase64,
    metadata: metadata || {},
  };

  return validateOrThrow(S3FileDocumentSchema, doc) as unknown as Record<string, unknown>;
}

export function buildKafkaMessage({ requestId, fileId, s3Key }: { requestId: string; fileId: string; s3Key: string }): Record<string, unknown> {
  const message = {
    source: SOURCE_NAME,
    path: s3Key,
    bucket: S3_BUCKET,
    message: `File ${fileId} processed and saved to S3`,
    request_id: requestId,
  };

  return validateOrThrow(KafkaMessageSchema, message) as unknown as Record<string, unknown>;
}

export async function publishToKafka(message: Record<string, unknown>, requestId: string): Promise<void> {
  await kafkaService.publish(message, requestId);
}
