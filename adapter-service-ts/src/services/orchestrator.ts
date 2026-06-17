// Orchestrator — מנהל את זרימת העיבוד: folder → files → pipeline.
import { FolderResponseSchema, CargoChild } from "../schemas";
import { validateOrThrow, logger, withRetry, config } from "../utils";
import { API_TYPES } from "../utils/constants";
import { STEPS, PROCESS_FILE_STEP } from "../utils/logger";
import { ApiClient } from "./connections/httpClient";
import { JobStore } from "./jobStore";
import { ErrorHandler } from "../utils/errorHandler";
import { FileDownloader, MetadataCollector, Publisher, METADATA_SOURCES } from "./pipeline";
import { FileInfo } from "../types";

export class Orchestrator {
  private apiClient: ApiClient;
  private jobStore: JobStore;
  private downloader: FileDownloader;
  private metadataCollector: MetadataCollector;
  private publisher: Publisher;

  constructor(apiClient: ApiClient, jobStore: JobStore, downloader: FileDownloader, metadataCollector: MetadataCollector, publisher: Publisher) {
    this.apiClient = apiClient;
    this.jobStore = jobStore;
    this.downloader = downloader;
    this.metadataCollector = metadataCollector;
    this.publisher = publisher;
  }

  // ============================================
  // run — background job
  // ============================================

  async run(folderId: string, startTime: number | null, endTime: number | null, recursive: boolean, requestId: string, apiType: string): Promise<void> {
    try {
      const sources = this.metadataCollector.getSources(apiType);

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

  private async processFolder(folderId: string, startTime: number | null, endTime: number | null, recursive: boolean, requestId: string, apiType: string): Promise<void> {
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
  // processFile — orchestrates pipeline per file
  // ============================================

  private async processFile(fileInfo: FileInfo, position: number, folderId: string, requestId: string, apiType: string) {
    const fileId = fileInfo.id;
    const startedAt = Date.now();
    let currentStep: PROCESS_FILE_STEP = PROCESS_FILE_STEP.UNKNOWN;

    try {
      currentStep = PROCESS_FILE_STEP.DOWNLOAD;
      const base64 = await this.downloader.download(fileId, requestId);

      currentStep = PROCESS_FILE_STEP.FETCH_METADATA;
      const metadata = await this.metadataCollector.collect(fileInfo, fileId, requestId, apiType);

      currentStep = PROCESS_FILE_STEP.PUBLISH;
      await this.publisher.publish(fileInfo, base64, metadata, requestId);

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

  private filterByTimeRange(children: CargoChild[], startTime: number | null, endTime: number | null): CargoChild[] {
    if (!startTime || !endTime) return children;
    return children.filter(({ isFolder, created }) => {
      if (isFolder) return true;
      if (!created) return false;
      return created >= startTime && created <= endTime;
    });
  }
}
