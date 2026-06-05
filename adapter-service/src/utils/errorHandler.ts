import http from "http";
import { ValidationError } from "./validation";

interface ClassifiedError {
  errorType: string;
  httpStatus: number | null;
  statusText: string | null;
  message: string;
}

export class ErrorHandler {
  static classify(error: Error, step: string): ClassifiedError {
    const httpStatus = (error as any).response?.status || null;
    const statusText = httpStatus ? (http.STATUS_CODES[httpStatus] || null) : null;

    let errorType: string;

    if (error instanceof ValidationError) {
      errorType = "VALIDATION_ERROR";
    } else if (httpStatus && statusText) {
      errorType = `HTTP_${httpStatus}_${statusText.replace(/\s+/g, "_").toUpperCase()}`;
    } else {
      errorType = "UNKNOWN_ERROR";
    }

    return { errorType, httpStatus, statusText, message: error.message };
  }

  static buildErrorData(error: Error, step: string, context: Record<string, unknown> = {}): Record<string, unknown> {
    const { errorType, httpStatus, statusText } = ErrorHandler.classify(error, step);

    return {
      errorType, httpStatus, statusText,
      failedStep: step,
      message: error.message,
      ...context,
      ...(error instanceof ValidationError ? { validationErrors: error.validationErrors } : {}),
      ...((error as any).response?.data ? { httpData: (error as any).response.data } : {}),
    };
  }

  static buildFileResult(fileId: string, error: Error, step: string) {
    const { errorType, httpStatus, statusText } = ErrorHandler.classify(error, step);

    return {
      success: false as const,
      fileId,
      failedStep: step,
      errorType, httpStatus, statusText,
      error: error.message,
    };
  }
}
