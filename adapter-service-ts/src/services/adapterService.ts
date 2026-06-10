// AdapterService — מנהל את כל תהליך ה-adapter.
// מקבל HTTP input, מוודא, מעבד קבצים, ומחזיר response.

import { FolderResponseSchema, AdapterRequestQuerySchema, AdapterRequestParamsSchema, CargoChild } from "../schemas";
import { validateOrThrow, buildS3Document, buildKafkaMessage, publishToKafka, logger, withRetry, config } from "../utils";
import { STEPS } from "../utils/logger";
import { ApiClient } from "./connections/httpClient";
import { S3Service } from "./connections/s3Client";
import { CargoMetadata } from "./cargoMetadata";
import { Source1Metadata } from "./source1Metadata";
import { CargoChatMetadata } from "./cargoChatMetadata";
import { JobStore } from "./jobStore";
import { ErrorHandler } from "../utils/errorHandler";
import { ValidationError } from "../errors";
import { v4 as uuidv4 } from "uuid";

interface FileInfo {
  id: string;
  name: string;
  owner?: string;
  description?: string;
  created?: number;
  [key: string]: unknown;
}

interface MetadataSource {
  prepare?(folderId: string, requestId: string): Promise<string | void>;
  process(fileId: string, requestId: string, fileInfo?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

// אילו metadata sources נוספים לכל סוג API.
// CargoMetadata תמיד רץ — זה רק למקורות נוספים.
const METADATA_SOURCES: Record<string, MetadataSource[]> = {
  default: [new Source1Metadata()],
  chat: [new CargoChatMetadata()],
};

export class AdapterService {
  private apiClient: ApiClient;
  private s3Service: S3Service;
  private cargoMetadata: CargoMetadata;
  private jobStore: JobStore;

  constructor(apiClient: ApiClient, s3Service: S3Service, jobStore: JobStore) {
    this.apiClient = apiClient;
    this.s3Service = s3Service;
    this.cargoMetadata = new CargoMetadata();
    this.jobStore = jobStore;
  }

  // ============================================
  // handleIngest — entry point for POST /download/:folderId
  // ============================================

  handleIngest(query: Record<string, string>, params: Record<string, string>, apiType = "default"): HttpResponse {
    const requestId = uuidv4();
    logger.log("INFO", requestId, STEPS.HTTP_REQUEST, "Request received");

    try {
      logger.log("INFO", requestId, STEPS.VALIDATE_INPUT, "Validating request");

      const validatedQuery = validateOrThrow(AdapterRequestQuerySchema, query);
      const { folderId } = validateOrThrow(AdapterRequestParamsSchema, params);

      const startTime = parseInt(validatedQuery.startTime, 10);
      const endTime = parseInt(validatedQuery.endTime, 10);
      const recursive = validatedQuery.recursive.toLowerCase() === "true";

      const existingJobId = this.jobStore.findRunning(folderId, startTime, endTime);
      if (existingJobId) {
        logger.log("WARN", requestId, STEPS.HTTP_REQUEST, "Job already running", { folderId, existingJobId });
        return { statusCode: 409, body: this.jobStore.toConflictResponse(existingJobId) };
      }

      this.jobStore.create(requestId, folderId, { startTime, endTime, recursive });
      this.run(folderId, startTime, endTime, recursive, requestId, apiType);

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

  // ============================================
  // run — background job
  // ============================================

  private async run(folderId: string, startTime: number, endTime: number, recursive: boolean, requestId: string, apiType: string): Promise<void> {
    try {
      const sources = METADATA_SOURCES[apiType] || METADATA_SOURCES.default;

      // prepare — הורדת Excel וכו'. אם מחזיר folderId חדש, משתמשים בו
      let targetFolderId = folderId;
      for (const source of sources) {
        if (source.prepare) {
          const subfolderId = await source.prepare(folderId, requestId);
          if (typeof subfolderId === "string") targetFolderId = subfolderId;
        }
      }

      await this.processFolder(targetFolderId, startTime, endTime, recursive, requestId, apiType);
      this.jobStore.complete(requestId);

      const job = this.jobStore.get(requestId)!;
      logger.log("INFO", requestId, STEPS.HTTP_RESPONSE, "Job completed", {
        folderId,
        totalFiles: job.progress.totalProcessed,
        succeeded: job.progress.succeeded,
        failed: job.progress.failed,
        failedFiles: job.results.filter(({ success }) => !success).map(({ fileId, failedStep, error }) => ({ fileId, failedStep, error })),
        recursive,
        durationMs: job.durationMs,
      });
    } catch (err) {
      this.jobStore.fail(requestId, (err as Error).message);
      logger.log("ERROR", requestId, STEPS.HTTP_RESPONSE, "Job failed", err);
    }
  }

  // ============================================
  // fetchFolder — HTTP GET → return children
  // ============================================

  private async fetchFolder(folderId: string, requestId: string): Promise<CargoChild[] | null> {
    logger.log("INFO", requestId, STEPS.COLLECT_FILES, "Fetching folder", { folderId });

    try {
      const response = await withRetry(
        () => this.apiClient.get(`/folders/${folderId}`),
        { retries: 3, delayMs: 1000, label: `list folder ${folderId}`, requestId }
      );
      const validated = validateOrThrow(FolderResponseSchema, response.data);
      return validated.children;
    } catch (err) {
      logger.log("ERROR", requestId, STEPS.COLLECT_FILES, `Failed to fetch folder ${folderId}, skipping`, { message: (err as Error).message, folderId });
      return null;
    }
  }

  // ============================================
  // processFolder — filter + process each child
  // ============================================

  private async processFolder(folderId: string, startTime: number, endTime: number, recursive: boolean, requestId: string, apiType: string): Promise<void> {
    const children = await this.fetchFolder(folderId, requestId);
    if (!children) return;

    const filtered = this.filterByTimeRange(children, startTime, endTime);

    logger.log("INFO", requestId, STEPS.VALIDATE_CHILDREN, "Children filtered", {
      folderId,
      totalChildren: children.length,
      afterFilter: filtered.length,
      folders: filtered.filter(({ isFolder }) => isFolder).length,
      files: filtered.filter(({ isFolder }) => !isFolder).length,
    });

    for (const child of filtered) {
      if (child.isFolder) {
        if (recursive) await this.processFolder(child.id, startTime, endTime, recursive, requestId, apiType);
      } else {
        await this.processFile(
          child,
          this.jobStore.get(requestId)?.progress.totalProcessed || 0,
          folderId,
          requestId,
          apiType
        );
      }
    }
  }

  // ============================================
  // processFile — full pipeline per file
  // ============================================

  private async processFile(fileInfo: FileInfo, position: number, folderId: string, requestId: string, apiType: string) {
    const fileId = fileInfo.id;
    const startedAt = Date.now();
    let currentStep = "unknown";

    try {
      currentStep = "download";
      const { base64 } = await this.downloadFileAsBase64(fileId, requestId);

      currentStep = "fetch_metadata";
      const cargoData = this.cargoMetadata.processCargo(fileInfo as Record<string, unknown>, requestId);
      const sources = METADATA_SOURCES[apiType] || METADATA_SOURCES.default;
      const additional = await Promise.all(
        sources.map((source) => source.process(fileId, requestId, fileInfo as Record<string, unknown>))
      );
      const metadata = Object.assign({}, cargoData, ...additional);

      currentStep = "build_s3_document";
      logger.log("INFO", requestId, STEPS.BUILD_S3_DOC, "Building S3 document", { fileId, metadataFields: Object.keys(metadata).length });
      const s3Document = buildS3Document({ fileInfo, fileBase64: base64, metadata });

      currentStep = "save_to_s3";
      const fileDate = fileInfo.created ? new Date(fileInfo.created * 1000) : undefined;
      const s3Key = await this.s3Service.save(s3Document, fileInfo.name, requestId, fileDate);

      currentStep = "build_kafka_msg";
      logger.log("INFO", requestId, STEPS.BUILD_KAFKA_MSG, "Building Kafka message", { fileId, s3Key });
      const kafkaMessage = buildKafkaMessage({ requestId, fileId, s3Key });

      currentStep = "kafka_produce";
      await publishToKafka(kafkaMessage, requestId);

      const durationMs = Date.now() - startedAt;
      const result = { success: true, fileId, source: config.sourceName, durationMs };
      this.jobStore.addFileResult(requestId, result);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const error = err as Error;
      const errorData = ErrorHandler.buildErrorData(error, currentStep, { fileId, fileName: fileInfo.name, folderId, position, durationMs });
      logger.log("ERROR", requestId, STEPS.CONVERT_FILE, `File ${fileId} failed at step: ${currentStep}`, errorData);
      const result = ErrorHandler.buildFileResult(fileId, error, currentStep, durationMs);
      this.jobStore.addFileResult(requestId, result);
      return result;
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  private filterByTimeRange(children: CargoChild[], startTime: number, endTime: number): CargoChild[] {
    return children.filter(({ isFolder, created }) => {
      if (isFolder) return true;
      if (!created) return false;
      return created >= startTime && created <= endTime;
    });
  }

  private async downloadFileAsBase64(fileId: string, requestId: string): Promise<{ base64: string }> {
    const response = await withRetry(
      () => this.apiClient.get(`/files/${fileId}/download`, { responseType: "arraybuffer" }),
      { retries: 3, delayMs: 1000, label: `download ${fileId}`, requestId }
    );
    const buffer = Buffer.from(response.data as ArrayBuffer);
    logger.log("INFO", requestId, STEPS.CONVERT_FILE, "File downloaded and converted to Base64", { fileId });
    return { base64: buffer.toString("base64") };
  }
}
