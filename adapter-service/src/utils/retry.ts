import * as logger from "./logger";

interface RetryOptions {
  retries?: number;
  delayMs?: number;
  label?: string;
  requestId?: string;
}
//CR we use arrow functions. same for all "declared" functions
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

//
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    delayMs = 1000,
    label = "operation",
    requestId = "system",
  } = options;

  let lastError: Error | undefined;
  //CR super small detail but use = 0 and less than. nothing wrong with what you wrote
  // but lets standerdize it in our projects to always be the same
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < retries) {
        //CR I would change var to waitTimeMS in order to not make var start with a verb
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
