
import { AdapterRequestQuerySchema, AdapterRequestParamsSchema } from "../schemas";
import { validateOrThrow, logger } from "../utils";
import { API_TYPES } from "../utils/constants";
import { STEPS } from "../utils/logger";
import { JobStore } from "./jobStore";
import { Orchestrator } from "./orchestrator";
import { ValidationError } from "../errors";
import { HttpResponse } from "../types";
import { v4 as uuidv4 } from "uuid";

export interface RunParams {
  folderId: string;
  startTime: number | null;
  endTime: number | null;
  recursive: boolean;
  apiType?: string;
  fileIds?: string[] | null;
}

export class AdapterService {
  private jobStore: JobStore;
  private orchestrator: Orchestrator;

  constructor(jobStore: JobStore, orchestrator: Orchestrator) {
    this.jobStore = jobStore;
    this.orchestrator = orchestrator;
  }


  /**
   * Generic entry point for a single run. Source-agnostic: HTTP handlers and
   * scheduled runners (batch/stream) all funnel through here with already-parsed
   * parameters. Creates a job and kicks off the orchestrator.
   *
   * @returns the new requestId, or an existing one if a matching job is already running.
   */
  runOnce(input: RunParams): { requestId: string; alreadyRunning: boolean } {
    const { folderId, startTime, endTime, recursive, apiType, fileIds } = input;

    const existingJobId = this.jobStore.findRunning(folderId, startTime, endTime);
    if (existingJobId) {
      logger.log("WARN", existingJobId, STEPS.HTTP_REQUEST, "Job already running", { folderId, existingJobId });
      return { requestId: existingJobId, alreadyRunning: true };
    }

    const requestId = uuidv4();
    this.jobStore.create(requestId, folderId, { startTime, endTime, recursive }, fileIds ? fileIds.length : null);
    this.orchestrator.run(folderId, startTime, endTime, recursive, requestId, apiType ?? API_TYPES.DEFAULT, fileIds);

    return { requestId, alreadyRunning: false };
  }

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
      const fileIds = validatedQuery.fileIds
        ? validatedQuery.fileIds.split(",").map((id) => id.trim()).filter((id) => id !== "")
        : null;

      const result = this.runOnce({ folderId, startTime, endTime, recursive, apiType, fileIds });

      if (result.alreadyRunning) {
        return { statusCode: 409, body: this.jobStore.toConflictResponse(result.requestId) };
      }

      return { statusCode: 202, body: this.jobStore.toCreatedResponse(result.requestId, folderId) };
    } catch (err) {
      logger.log("ERROR", requestId, STEPS.HTTP_RESPONSE, "Request failed", err);
      const statusCode = err instanceof ValidationError ? 422 : 500;
      return { statusCode, body: { success: false, error: (err as Error).message, requestId } };
    }
  }


  handleStatus(requestId: string): HttpResponse {
    const response = this.jobStore.toResponse(requestId);

    if (!response) {
      return { statusCode: 404, body: { success: false, error: "Job not found", requestId } };
    }

    return { statusCode: 200, body: response };
  }
}
