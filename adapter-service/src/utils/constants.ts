export const SOURCE_NAME = "adapter-service";
export const S3_BUCKET = process.env.S3_BUCKET || "raw-data";
export const AWS_REGION = process.env.AWS_REGION || "us-east-1";
export const KAFKA_TOPIC = "adapter.file.downloads";

export const METADATA_API_1_PREFIX = "ex";

export const METADATA_API_2_PREFIX = "ab";
export const METADATA_API_2_FIELDS = ["*"];
