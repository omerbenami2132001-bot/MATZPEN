export enum JOB_STATUS {
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface FileResult {
  success: boolean;
  fileId: string;
  source: string;
  durationMs: number;
  failedStep?: string;
  errorType?: string;
  error?: string;
  httpStatus?: number | null;
  statusText?: string | null;
  validationErrors?: string[];
}

export interface Job {
  requestId: string;
  folderId: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  params: { startTime: number | null; endTime: number | null; recursive: boolean };
  progress: { totalProcessed: number; succeeded: number; failed: number };
  fileIdFilter: { requested: number; matched: number; skipped: number } | null;
  results: FileResult[];
  error: string | null;
}

export class JobStore {
  private static instance: JobStore;
  private jobs: Map<string, Job> = new Map();

  private constructor() {}

  static getInstance(): JobStore {
    if (!JobStore.instance) {
      JobStore.instance = new JobStore();
    }
    return JobStore.instance;
  }

  create(requestId: string, folderId: string, params: { startTime: number | null; endTime: number | null; recursive: boolean }, fileIdCount: number | null = null): Job {
    const job: Job = {
      requestId, folderId,
      status: JOB_STATUS.RUNNING,
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: null,
      params,
      progress: { totalProcessed: 0, succeeded: 0, failed: 0 },
      fileIdFilter: fileIdCount !== null ? { requested: fileIdCount, matched: 0, skipped: 0 } : null,
      results: [],
      error: null,
    };
    this.jobs.set(requestId, job);
    return job;
  }

  recordFileIdMatch(requestId: string): void {
    const job = this.jobs.get(requestId);
    if (!job || !job.fileIdFilter) return;
    job.fileIdFilter.matched++;
  }

  recordFileIdSkip(requestId: string): void {
    const job = this.jobs.get(requestId);
    if (!job || !job.fileIdFilter) return;
    job.fileIdFilter.skipped++;
  }

  get(requestId: string): Job | null {
    return this.jobs.get(requestId) || null;
  }

  addFileResult(requestId: string, fileResult: FileResult): void {
    const job = this.jobs.get(requestId);
    if (!job) return;

    job.results.push(fileResult);
    job.progress.totalProcessed++;
    if (fileResult.success) { job.progress.succeeded++; }
    else { job.progress.failed++; }
  }

  complete(requestId: string): void {
    const job = this.jobs.get(requestId);
    if (!job) return;
    job.status = JOB_STATUS.COMPLETED;
    job.finishedAt = Date.now();
    job.durationMs = job.finishedAt - job.startedAt;
  }

  fail(requestId: string, errorMessage: string): void {
    const job = this.jobs.get(requestId);
    if (!job) return;
    job.status = JOB_STATUS.FAILED;
    job.error = errorMessage;
    job.finishedAt = Date.now();
    job.durationMs = job.finishedAt - job.startedAt;
  }

  findRunning(folderId: string, startTime: number | null, endTime: number | null): string | null {
    for (const [requestId, job] of this.jobs) {
      if (job.status === JOB_STATUS.RUNNING && job.folderId === folderId &&
          job.params.startTime === startTime && job.params.endTime === endTime) {
        return requestId;
      }
    }
    return null;
  }

  toCreatedResponse(requestId: string, folderId: string): Record<string, unknown> {
    return {
      success: true,
      requestId,
      folderId,
      message: "Processing started",
      statusUrl: `/adapter/status/${requestId}`,
    };
  }

  toConflictResponse(existingJobId: string): Record<string, unknown> {
    return {
      success: false,
      error: "A job with the same folder and time range is already running",
      existingJobId,
      statusUrl: `/adapter/status/${existingJobId}`,
    };
  }

  toResponse(requestId: string): Record<string, unknown> | null {
    const job = this.jobs.get(requestId);
    if (!job) return null;

    const isRunning = job.status === JOB_STATUS.RUNNING;

    return {
      requestId: job.requestId,
      folderId: job.folderId,
      status: job.status,
      progress: job.progress,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      durationMs: isRunning ? Date.now() - job.startedAt : job.durationMs,
      params: job.params,
      ...(job.fileIdFilter ? { fileIdFilter: job.fileIdFilter } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(!isRunning ? {
        results: {
          succeeded: job.results.filter(({ success }) => success).map(({ fileId, durationMs }) => ({ fileId, durationMs })),
          failed: job.results.filter(({ success }) => !success).map(({ fileId, durationMs, failedStep, errorType, error, httpStatus, statusText, validationErrors }) => ({
            fileId,
            durationMs,
            failedStep,
            errorType,
            error,
            ...(httpStatus ? { httpStatus, statusText } : {}),
            ...(validationErrors ? { validationErrors } : {}),
          })),
        },
      } : {}),
    };
  }
}
