function formatLog(level: string, requestId: string, step: string, message: string, data?: unknown): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    requestId: requestId || "system",
    step,
    message,
  };

  if (data !== undefined && data !== null) {
    // אם data הוא Error — מחלצים message + stack
    if (data instanceof Error) {
      entry.data = {
        errorMessage: data.message,
        ...(process.env.NODE_ENV !== "production" && data.stack ? { stack: data.stack } : {}),
      };
    } else {
      entry.data = data;
    }
  }

  return JSON.stringify(entry);
}

export function log(level: string, requestId: string, step: string, message: string, data?: unknown): void {
  const output = formatLog(level, requestId, step, message, data);

  if (level === "ERROR") {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const STEPS = {
  HTTP_REQUEST: "http_request",
  VALIDATE_INPUT: "validate_input",
  COLLECT_FILES: "collect_files",
  VALIDATE_CHILDREN: "validate_children",
  CONVERT_FILE: "convert_file",
  FETCH_METADATA: "fetch_metadata",
  VALIDATE_S3_DOC: "validate_s3_doc",
  SAVE_S3: "save_s3",
  VALIDATE_KAFKA_MSG: "validate_kafka_msg",
  KAFKA_PRODUCE: "kafka_produce",
  HTTP_RESPONSE: "http_response",
} as const;
