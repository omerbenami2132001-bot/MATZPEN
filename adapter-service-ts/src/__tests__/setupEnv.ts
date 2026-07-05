process.env.SOURCE_NAME = process.env.SOURCE_NAME || "test-adapter";
process.env.S3_RAW_BUCKET_NAME = process.env.S3_RAW_BUCKET_NAME || "test-bucket";
process.env.S3_REGION = process.env.S3_REGION || "us-east-1";
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:4566";
process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "test-key";
process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "test-secret";
process.env.KAFKA_CONSUMER_TOPIC = process.env.KAFKA_CONSUMER_TOPIC || "test.topic";
process.env.API_BASE_URL = process.env.API_BASE_URL || "http://localhost:9999";
process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.API_NAME = process.env.API_NAME || "test-app";

const g = global as unknown as { __ADAPTER_TEST_SETUP__?: boolean };

if (!g.__ADAPTER_TEST_SETUP__) {
  g.__ADAPTER_TEST_SETUP__ = true;

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const isLoggerLine = (args: unknown[]): boolean => {
    if (args.length !== 1 || typeof args[0] !== "string") return false;
    const s = args[0] as string;
    return s.startsWith("{") && s.includes("\"timestamp\"") && s.includes("\"level\"");
  };
  console.log = (...args: unknown[]) => { if (!isLoggerLine(args)) origLog(...args); };
  console.error = (...args: unknown[]) => { if (!isLoggerLine(args)) origError(...args); };

  const realSetTimeout = global.setTimeout;
  global.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...rest: unknown[]) => {
    return realSetTimeout(fn, 0, ...rest);
  }) as typeof global.setTimeout;
}

export {};
