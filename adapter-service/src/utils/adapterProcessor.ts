import { FolderResponseSchema, AdapterRequestHeadersSchema, AdapterRequestParamsSchema, Child } from "../schemas";
import { validateOrThrow, buildS3Document, buildKafkaMessage, publishToKafka, logger, withRetry } from "../utils";
import { STEPS } from "../utils/logger";
import { ApiClient } from "../utils/httpClient";
import { S3Service } from "../utils/s3Client";
import { MetadataClient } from "../utils/metadataClient";
import { JobStore } from "../utils/jobStore";
import { ErrorHandler } from "../utils/errorHandler";
//for large classes types and interfaces should be in a types file
interface FileInfo {
  id: string;
  name: string;
  owner?: string;
  description?: string;
  created?: number;
  [key: string]: unknown;
}

export interface ParsedRequest {
  folderId: string;
  startTime: number;
  endTime: number;
  recursive: boolean;
}
//CR seems weird to have only one 
export class AdapterProcessor {
  private apiClient: ApiClient;
  private s3Service: S3Service;
  private metadataClient: MetadataClient;
  private jobStore: JobStore;

  constructor(apiClient: ApiClient, s3Service: S3Service, metadataClient: MetadataClient, jobStore: JobStore) {
    this.apiClient = apiClient;
    this.s3Service = s3Service;
    this.metadataClient = metadataClient;
    this.jobStore = jobStore;
  }

  // ============================================
  // validateRequest — validate + parse HTTP input
  // ============================================

  static validateRequest(headers: Record<string, string>, params: Record<string, string>): ParsedRequest {
    const validatedHeaders = validateOrThrow(AdapterRequestHeadersSchema, headers);
    const { folderId } = validateOrThrow(AdapterRequestParamsSchema, params);

    return {
      folderId,
      startTime: parseInt(validatedHeaders["x-start-time"], 10),
      endTime: parseInt(validatedHeaders["x-end-time"], 10),
      recursive: validatedHeaders["x-recursive"].toLowerCase() === "true",
    };
  }

  // ============================================
  // filterByTimeRange — סינון children לפי תאריך
  // ============================================

  private filterByTimeRange(children: Child[], startTime: number, endTime: number): Child[] {
    return children.filter((child) => {
      if (child.isFolder) return true;
      if (!child.created) return false;
      return child.created >= startTime && child.created <= endTime;
    });
  }

  // ============================================
  // downloadFileAsBase64 — הורדת קובץ + המרה
  // ============================================

  private async downloadFileAsBase64(fileId: string, requestId: string): Promise<{ base64: string }> {
    const response = await withRetry(
      () => this.apiClient.get(`/files/${fileId}/download`, { responseType: "arraybuffer" }),
      { retries: 3, delayMs: 1000, label: `download ${fileId}`, requestId }
    );
    const buffer = Buffer.from(response.data as ArrayBuffer);
    logger.log("INFO", requestId, STEPS.CONVERT_FILE, "File downloaded and converted to Base64", { fileId });
    return { base64: buffer.toString("base64") };
  }

  // ============================================
  // processFile — pipeline מלא לקובץ בודד
  // ============================================

  private async processFile(fileInfo: FileInfo, position: number, folderId: string, requestId: string) {
    const fileId = fileInfo.id;
    //CR good use of let (:
    let currentStep = "unknown";

    try {
      currentStep = "download";
      const { base64 } = await this.downloadFileAsBase64(fileId, requestId);

      currentStep = "fetch_metadata";
      const metadata = await this.metadataClient.fetchAll(fileId, requestId, fileInfo as Record<string, unknown>);
      //CR weired name for step no? it is build not validate
      currentStep = "validate_s3_document";
      logger.log("INFO", requestId, STEPS.VALIDATE_S3_DOC, "Validating S3 document", { fileId, metadataFields: Object.keys(metadata).length });
      const s3Document = buildS3Document({ fileInfo, fileBase64: base64, metadata });

      currentStep = "save_to_s3";
      const s3Key = await this.s3Service.save(s3Document, fileInfo.name, requestId);

      currentStep = "validate_kafka_msg";
      logger.log("INFO", requestId, STEPS.VALIDATE_KAFKA_MSG, "Validating Kafka message", { fileId, s3Key });
      const kafkaMessage = buildKafkaMessage({ requestId, fileId, s3Key });

      currentStep = "kafka_produce";
      await publishToKafka(kafkaMessage, requestId);

      const result = { success: true, fileId };
      this.jobStore.addFileResult(requestId, result);
      return result;
    } catch (err) {
      const error = err as Error;
      const errorData = ErrorHandler.buildErrorData(error, currentStep, { fileId, fileName: fileInfo.name, folderId, position });
      logger.log("ERROR", requestId, STEPS.CONVERT_FILE, `File ${fileId} failed at step: ${currentStep}`, errorData);
      const result = ErrorHandler.buildFileResult(fileId, error, currentStep);
      this.jobStore.addFileResult(requestId, result);
      return result;
    }
  }

  // ============================================
  // processFolder — סורק תיקייה, רקורסיבי
  // ============================================
  //CR proccess function shouldn't retrieve data, and retriving function (non existant) should'nt process it
  // please split into two functions for less resposnibility on one single function
  private async processFolder(folderId: string, startTime: number, endTime: number, recursive: boolean, requestId: string): Promise<void> {
    logger.log("INFO", requestId, STEPS.COLLECT_FILES, "Scanning folder", { folderId });
    //CR never use let unless you need to iterate and add to a value! best practice to use const
    let response;
    try {
      response = await withRetry(
        () => this.apiClient.get(`/folders/${folderId}`),
        { retries: 3, delayMs: 1000, label: `list folder ${folderId}`, requestId }
      );
    } catch (err) {
      logger.log("ERROR", requestId, STEPS.COLLECT_FILES, `Failed to scan folder ${folderId}, skipping`, { message: (err as Error).message, folderId });
      return;
    }

    const validated = validateOrThrow(FolderResponseSchema, response.data);
    const filtered = this.filterByTimeRange(validated.children, startTime, endTime);

    logger.log("INFO", requestId, STEPS.VALIDATE_CHILDREN, "Children validated and filtered", {
      folderId,
      totalChildren: validated.children.length,
      afterFilter: filtered.length,
      folders: filtered.filter((c) => c.isFolder).length,
      files: filtered.filter((c) => !c.isFolder).length,
    });
    //CR can destructre item into its children for easier readablility
    for (const item of filtered) {
      if (item.isFolder) {
        if (recursive) await this.processFolder(item.id, startTime, endTime, recursive, requestId);
      } else {
        await this.processFile(
          { id: item.id, name: item.name, owner: item.owner, description: item.description, created: item.created },
          this.jobStore.get(requestId)?.progress.totalProcessed || 0,
          folderId,
          requestId
        );
      }
    }
  }

  // ============================================
  // run — הכניסה הציבורית היחידה
  // ============================================

  async run(folderId: string, startTime: number, endTime: number, recursive: boolean, requestId: string): Promise<void> {
    try {
      await this.processFolder(folderId, startTime, endTime, recursive, requestId);
      this.jobStore.complete(requestId);

      const job = this.jobStore.get(requestId)!;
      logger.log("INFO", requestId, STEPS.HTTP_RESPONSE, "Job completed", {
        folderId,
        totalFiles: job.progress.totalProcessed,
        succeeded: job.progress.succeeded,
        failed: job.progress.failed,
        failedFiles: job.results.filter((r) => !r.success).map((f) => ({ fileId: f.fileId, failedStep: f.failedStep, error: f.error })),
        recursive,
        durationMs: job.durationMs,
      });
    } catch (err) {
      this.jobStore.fail(requestId, (err as Error).message);
      logger.log("ERROR", requestId, STEPS.HTTP_RESPONSE, "Job failed", err);
    }
  }
}
