import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { AWS_REGION, S3_BUCKET, SOURCE_NAME } from "./constants";
import { withRetry } from "./retry";
import * as logger from "./logger";
import { STEPS } from "./logger";

//CR this is good. you have some functionallity we don't have in other services.
// how do we make sure all of our services use the same code for s3 service?
export class S3Service {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.client = new S3Client({
      region: AWS_REGION,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    this.bucket = S3_BUCKET;
  }

  /**
   * בודק שהחיבור ל-S3 עובד וה-bucket נגיש
   * HeadBucket = בקשה קלה שבודקת שה-bucket קיים ויש הרשאות
   */
  async connect(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    logger.log("INFO", "system", STEPS.SAVE_S3, "S3 connection verified", {
      bucket: this.bucket,
      endpoint: process.env.S3_ENDPOINT,
    });
  }
  //CR buildKey should get a date and infer the key from it (for when we do backfills and don't
  // want the path to be now)
  buildKey(fileName: string): string {

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const date = String(now.getUTCDate()).padStart(2, "0");
    const hour = String(now.getUTCHours()).padStart(2, "0");

    const lastDot = fileName.lastIndexOf(".");
    const baseName = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
    //CR we want to put it in a seperate folder inside the images bucket
    // for example raw/{SOURCE_NAME}/...
    return `${SOURCE_NAME}/${year}/${month}/${date}/${hour}/${baseName}.json`;
  }

  async save(document: Record<string, unknown>, fileName: string, requestId: string): Promise<string> {
    const s3Key = this.buildKey(fileName);

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

export const s3Service = new S3Service();
