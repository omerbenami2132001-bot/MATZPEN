import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { config } from "../../utils/config";
import { withRetry } from "../../utils/retry";
import * as logger from "../../utils/logger";
import { STEPS } from "../../utils/logger";

export class S3Service {
  private static instance: S3Service;
  private client: S3Client;
  private bucket: string;

  private constructor() {
    this.client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    this.bucket = config.s3.bucket;
  }

  static getInstance(): S3Service {
    if (!S3Service.instance) {
      S3Service.instance = new S3Service();
    }
    return S3Service.instance;
  }

  async connect(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    logger.log("INFO", "system", STEPS.SAVE_S3, "S3 connection verified", {
      bucket: this.bucket,
      endpoint: config.s3.endpoint,
    });
  }

  buildKey(fileName: string, date: Date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");

    const lastDot = fileName.lastIndexOf(".");
    const baseName = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;

    return `${config.sourceName}/${year}/${month}/${day}/${hour}/${baseName}.json`;
  }

  async save(document: Record<string, unknown>, fileName: string, requestId: string, date?: Date): Promise<string> {
    const s3Key = this.buildKey(fileName, date);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      Body: JSON.stringify(document),
      ContentType: "application/json",
    });

    await withRetry(
      () => this.client.send(command),
      { retries: 3, delayMs: 1000, label: `S3 upload ${s3Key}`, requestId }
    );

    logger.log("INFO", requestId, STEPS.SAVE_S3, "Document saved to S3", {
      bucket: this.bucket, s3Key,
      originId: (document as any).origin_id,
      fileType: (document as any).original_file_type,
    });

    return s3Key;
  }
}
