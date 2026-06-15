import "dotenv/config";

export const config = {
  port: process.env.PORT || 3000,
  sourceName: process.env.SOURCE_NAME || "adapter-service",
  api: {
    baseUrl: process.env.API_BASE_URL,
    key: process.env.API_KEY,
    name: process.env.API_NAME,
  },
  s3: {
    bucketName: process.env.S3_BUCKET_NAME || "raw-data",
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
  },
  kafka: {
    topic: process.env.KAFKA_TOPIC || "adapter.file.downloads",
    brokers: process.env.KAFKA_PRODUCER_BROKERS,
    certPath: process.env.KAFKA_CERT,
    keyPath: process.env.KAFKA_KEY,
  },
  metadata: {
    api2Url: process.env.METADATA_API_2_URL,
  },
};

export function validateConfig() {
  const missing: string[] = [];

  if (!config.api.baseUrl) missing.push("API_BASE_URL");
  if (!config.api.key) missing.push("API_KEY");
  if (!config.api.name) missing.push("API_NAME");

  if (missing.length > 0) {
    console.error(`FATAL: Missing required ENV variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}
