// AdapterService — entry point ל-HTTP.
// אחראי על validation, ניהול jobs, ו-delegation ל-Orchestrator.

import { AdapterRequestQuerySchema, AdapterRequestParamsSchema } from "../schemas";
import { validateOrThrow, logger } from "../utils";
import { API_TYPES } from "../utils/constants";
import { STEPS } from "../utils/logger";
import { JobStore } from "./jobStore";
import { Orchestrator } from "./orchestrator";
import { ValidationError } from "../errors";
import { HttpResponse } from "../types";
import { v4 as uuidv4 } from "uuid";

export class AdapterService {
  private jobStore: JobStore;
  private orchestrator: Orchestrator;

  constructor(jobStore: JobStore, orchestrator: Orchestrator) {
    this.jobStore = jobStore;
    this.orchestrator = orchestrator;
  }

  // ============================================
  // handleIngest — entry point for POST /download/:folderId
  // ============================================

  handleIngest(query: Record<string, string>, params: Record<string, string>, apiType: string = API_TYPES.DEFAULT): HttpResponse {
    const requestId = uuidv4();
    logger.log("INFO", requestId, STEPS.HTTP_REQUEST, "Request received");

    try {
      logger.log("INFO", requestId, STEPS.VALIDATE_INPUT, "Validating request");

      const validatedQuery = validateOrThrow(AdapterRequestQuerySchema, query);
      const { folderId } = validateOrThrow(AdapterRequestParamsSchema, params);

      const startTime = validatedQuery.startTime ? parseInt(validatedQuery.startTime, 10) : null;
      const endTime = validatedQuery.endTime ? parseInt(validatedQuery.endTime, 10) : null;
      const recursive = validatedQuery.recursive.toLowerCase() === "true";

      const existingJobId = this.jobStore.findRunning(folderId, startTime, endTime);
      if (existingJobId) {
        logger.log("WARN", requestId, STEPS.HTTP_REQUEST, "Job already running", { folderId, existingJobId });
        return { statusCode: 409, body: this.jobStore.toConflictResponse(existingJobId) };
      }

      this.jobStore.create(requestId, folderId, { startTime, endTime, recursive });
      this.orchestrator.run(folderId, startTime, endTime, recursive, requestId, apiType);

      return { statusCode: 202, body: this.jobStore.toCreatedResponse(requestId, folderId) };
    } catch (err) {
      logger.log("ERROR", requestId, STEPS.HTTP_RESPONSE, "Request failed", err);
      const statusCode = err instanceof ValidationError ? 422 : 500;
      return { statusCode, body: { success: false, error: (err as Error).message, requestId } };
    }
  }

  // ============================================
  // handleStatus — entry point for GET /status/:requestId
  // ============================================

  handleStatus(requestId: string): HttpResponse {
    const response = this.jobStore.toResponse(requestId);

    if (!response) {
      return { statusCode: 404, body: { success: false, error: "Job not found", requestId } };
    }

    return { statusCode: 200, body: response };
  }
}
