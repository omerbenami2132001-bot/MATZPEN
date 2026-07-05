import "./setupEnv";
import { describe, test, assert, assertEqual } from "./harness";
import { JobStore, JOB_STATUS, FileResult } from "../services/jobStore";

function freshStore(): JobStore {
  (JobStore as unknown as { instance?: JobStore }).instance = undefined;
  return JobStore.getInstance();
}

const baseParams = { startTime: null, endTime: null, recursive: false };

describe("JobStore.create", () => {
  test("creates a RUNNING job with zeroed progress", () => {
    const store = freshStore();
    const job = store.create("req-1", "folder-1", baseParams);
    assertEqual(job.status, JOB_STATUS.RUNNING, "status");
    assertEqual(job.progress.totalProcessed, 0, "totalProcessed");
    assertEqual(job.progress.succeeded, 0, "succeeded");
    assertEqual(job.progress.failed, 0, "failed");
    assertEqual(job.finishedAt, null, "finishedAt null");
    assertEqual(job.durationMs, null, "durationMs null");
    assertEqual(job.error, null, "error null");
  });

  test("fileIdFilter is null when no count passed", () => {
    const store = freshStore();
    const job = store.create("req-1", "folder-1", baseParams);
    assertEqual(job.fileIdFilter, null, "fileIdFilter null");
  });

  test("fileIdFilter initialized when count passed", () => {
    const store = freshStore();
    const job = store.create("req-1", "folder-1", baseParams, 5);
    assert(job.fileIdFilter !== null, "fileIdFilter not null");
    assertEqual(job.fileIdFilter!.requested, 5, "requested");
    assertEqual(job.fileIdFilter!.matched, 0, "matched");
    assertEqual(job.fileIdFilter!.skipped, 0, "skipped");
  });

  test("fileIdFilter initialized when count is 0 (explicit empty)", () => {
    const store = freshStore();
    const job = store.create("req-1", "folder-1", baseParams, 0);
    assert(job.fileIdFilter !== null, "fileIdFilter not null for 0");
    assertEqual(job.fileIdFilter!.requested, 0, "requested 0");
  });
});

describe("JobStore.addFileResult", () => {
  test("increments succeeded and totalProcessed on success", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    const result: FileResult = { success: true, fileId: "f1", source: "test", durationMs: 10 };
    store.addFileResult("req-1", result);
    const job = store.get("req-1")!;
    assertEqual(job.progress.totalProcessed, 1, "totalProcessed");
    assertEqual(job.progress.succeeded, 1, "succeeded");
    assertEqual(job.progress.failed, 0, "failed");
  });

  test("increments failed on failure", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    store.addFileResult("req-1", { success: false, fileId: "f1", source: "test", durationMs: 10 });
    const job = store.get("req-1")!;
    assertEqual(job.progress.failed, 1, "failed");
    assertEqual(job.progress.succeeded, 0, "succeeded");
  });

  test("no-op for unknown requestId", () => {
    const store = freshStore();
    store.addFileResult("ghost", { success: true, fileId: "f1", source: "test", durationMs: 10 });
    assertEqual(store.get("ghost"), null, "ghost stays null");
  });
});

describe("JobStore.complete / fail", () => {
  test("complete sets COMPLETED, finishedAt, durationMs", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    store.complete("req-1");
    const job = store.get("req-1")!;
    assertEqual(job.status, JOB_STATUS.COMPLETED, "status");
    assert(job.finishedAt !== null, "finishedAt set");
    assert(job.durationMs !== null && job.durationMs >= 0, "durationMs set");
  });

  test("fail sets FAILED and error message", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    store.fail("req-1", "boom");
    const job = store.get("req-1")!;
    assertEqual(job.status, JOB_STATUS.FAILED, "status");
    assertEqual(job.error, "boom", "error message");
    assert(job.finishedAt !== null, "finishedAt set");
  });

  test("complete is no-op for unknown requestId", () => {
    const store = freshStore();
    store.complete("ghost");
    assertEqual(store.get("ghost"), null, "still null");
  });
});

describe("JobStore.fileIdFilter counters", () => {
  test("recordFileIdMatch / recordFileIdSkip accumulate", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams, 3);
    store.recordFileIdMatch("req-1");
    store.recordFileIdMatch("req-1");
    store.recordFileIdSkip("req-1");
    const job = store.get("req-1")!;
    assertEqual(job.fileIdFilter!.matched, 2, "matched");
    assertEqual(job.fileIdFilter!.skipped, 1, "skipped");
  });

  test("counters are no-op when fileIdFilter is null", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    store.recordFileIdMatch("req-1");
    store.recordFileIdSkip("req-1");
    assertEqual(store.get("req-1")!.fileIdFilter, null, "still null");
  });
});

describe("JobStore.findRunning (dedup)", () => {
  test("finds a running job with matching folder + time range", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", { startTime: 100, endTime: 200, recursive: false });
    const found = store.findRunning("folder-1", 100, 200);
    assertEqual(found, "req-1", "found req-1");
  });

  test("does not match different time range", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", { startTime: 100, endTime: 200, recursive: false });
    assertEqual(store.findRunning("folder-1", 100, 999), null, "no match");
  });

  test("does not match completed job", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", { startTime: 100, endTime: 200, recursive: false });
    store.complete("req-1");
    assertEqual(store.findRunning("folder-1", 100, 200), null, "completed excluded");
  });

  test("matches null time range", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    assertEqual(store.findRunning("folder-1", null, null), "req-1", "null range matches");
  });
});

describe("JobStore.toResponse", () => {
  test("returns null for unknown requestId", () => {
    const store = freshStore();
    assertEqual(store.toResponse("ghost"), null, "null");
  });

  test("running job: durationMs is elapsed (number), no results block", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    const resp = store.toResponse("req-1")!;
    assertEqual(resp.status, JOB_STATUS.RUNNING, "status");
    assert(typeof resp.durationMs === "number", "durationMs is number while running");
    assert(!("results" in resp), "no results block while running");
  });

  test("completed job: includes results block with succeeded/failed", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    store.addFileResult("req-1", { success: true, fileId: "ok1", source: "test", durationMs: 5 });
    store.addFileResult("req-1", { success: false, fileId: "bad1", source: "test", durationMs: 7, failedStep: "download", errorType: "HTTP_500", error: "server error" });
    store.complete("req-1");
    const resp = store.toResponse("req-1")! as Record<string, any>;
    assert("results" in resp, "results present");
    assertEqual(resp.results.succeeded.length, 1, "1 succeeded");
    assertEqual(resp.results.failed.length, 1, "1 failed");
    assertEqual(resp.results.failed[0].fileId, "bad1", "failed fileId");
    assertEqual(resp.results.failed[0].failedStep, "download", "failedStep");
  });

  test("includes fileIdFilter in response when present", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams, 2);
    store.recordFileIdMatch("req-1");
    const resp = store.toResponse("req-1")! as Record<string, any>;
    assert("fileIdFilter" in resp, "fileIdFilter present");
    assertEqual(resp.fileIdFilter.requested, 2, "requested");
    assertEqual(resp.fileIdFilter.matched, 1, "matched");
  });

  test("omits fileIdFilter when null", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    const resp = store.toResponse("req-1")! as Record<string, any>;
    assert(!("fileIdFilter" in resp), "fileIdFilter omitted");
  });

  test("failed job includes error field", () => {
    const store = freshStore();
    store.create("req-1", "folder-1", baseParams);
    store.fail("req-1", "kaboom");
    const resp = store.toResponse("req-1")! as Record<string, any>;
    assertEqual(resp.error, "kaboom", "error surfaced");
  });
});
