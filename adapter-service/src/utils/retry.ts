import * as logger from "./logger";

interface RetryOptions {
  retries?: number;
  delayMs?: number;
  label?: string;
  requestId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    delayMs = 1000,
    label = "operation",
    requestId = "system",
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < retries) {
        const waitMs = delayMs * Math.pow(2, attempt - 1);
        logger.log("WARN", requestId, "retry", `${label} failed (attempt ${attempt}/${retries}), retrying in ${waitMs}ms`, {
          error: lastError.message, attempt, retries, waitMs,
        });
        await sleep(waitMs);
      }
    }
  }

  logger.log("ERROR", requestId, "retry", `${label} failed after ${retries} attempts`, lastError);
  throw lastError;
}
