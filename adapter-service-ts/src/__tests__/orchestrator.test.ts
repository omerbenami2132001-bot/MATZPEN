import "./setupEnv";
import { describe, test, assert, assertEqual } from "./harness";
import { Orchestrator } from "../services/orchestrator";
import { JobStore } from "../services/jobStore";

type Child = { id: string; name: string; isFolder: boolean; created?: number; childCount?: number };

function freshStore(): JobStore {
  (JobStore as unknown as { instance?: JobStore }).instance = undefined;
  return JobStore.getInstance();
}

// Builds an orchestrator whose apiClient.get returns folder contents from a map.
// folders: { folderId: Child[] }. Records processed file ids via the downloader spy.
function buildOrchestrator(folders: Record<string, Child[]>) {
  const downloadedIds: string[] = [];

  const apiClient = {
    get: async (url: string) => {
      const match = url.match(/\/folders\/(.+)$/);
      const folderId = match ? match[1] : "";
      const children = folders[folderId] || [];
      return { data: { children }, status: 200 };
    },
  };

  const downloader = {
    download: async (fileId: string) => {
      downloadedIds.push(fileId);
      return "base64data";
    },
  };

  const metadataCollector = {
    getSources: (_apiType: string) => [] as unknown[],
    collect: async () => ({}),
  };

  const publisher = {
    publish: async () => {},
  };

  const jobStore = freshStore();
  const orchestrator = new Orchestrator(
    apiClient as never,
    jobStore as never,
    downloader as never,
    metadataCollector as never,
    publisher as never
  );

  // Mirrors adapterService: create the job (with fileId count) before running.
  const runJob = async (
    folderId: string,
    startTime: number | null,
    endTime: number | null,
    recursive: boolean,
    requestId: string,
    apiType: string,
    fileIds: string[] | null = null
  ) => {
    jobStore.create(requestId, folderId, { startTime, endTime, recursive }, fileIds ? fileIds.length : null);
    await orchestrator.run(folderId, startTime, endTime, recursive, requestId, apiType, fileIds);
  };

  return { orchestrator, jobStore, downloadedIds, runJob };
}

describe("Orchestrator.run - basic processing", () => {
  test("processes image files in a flat folder", async () => {
    const { runJob, jobStore, downloadedIds } = buildOrchestrator({
      root: [
        { id: "a", name: "a.png", isFolder: false },
        { id: "b", name: "b.jpg", isFolder: false },
      ],
    });
    await runJob("root", null, null, false, "req-1", "default");
    assertEqual(downloadedIds.length, 2, "2 files downloaded");
    const job = jobStore.get("req-1")!;
    assertEqual(job.progress.succeeded, 2, "2 succeeded");
    assertEqual(job.status, "completed", "job completed");
  });

  test("skips non-image files", async () => {
    const { runJob, jobStore, downloadedIds } = buildOrchestrator({
      root: [
        { id: "a", name: "a.png", isFolder: false },
        { id: "doc", name: "notes.txt", isFolder: false },
      ],
    });
    await runJob("root", null, null, false, "req-1", "default");
    assertEqual(downloadedIds.length, 1, "only image downloaded");
    assert(downloadedIds.includes("a"), "image processed");
    assert(!downloadedIds.includes("doc"), "txt skipped");
  });
});

describe("Orchestrator.run - recursion", () => {
  test("recurses into subfolders when recursive=true", async () => {
    const { runJob, downloadedIds } = buildOrchestrator({
      root: [
        { id: "img1", name: "1.png", isFolder: false },
        { id: "sub", name: "subfolder", isFolder: true },
      ],
      sub: [{ id: "img2", name: "2.png", isFolder: false }],
    });
    await runJob("root", null, null, true, "req-1", "default");
    assertEqual(downloadedIds.length, 2, "both levels processed");
    assert(downloadedIds.includes("img2"), "nested file reached");
  });

  test("does NOT recurse when recursive=false", async () => {
    const { runJob, downloadedIds } = buildOrchestrator({
      root: [
        { id: "img1", name: "1.png", isFolder: false },
        { id: "sub", name: "subfolder", isFolder: true },
      ],
      sub: [{ id: "img2", name: "2.png", isFolder: false }],
    });
    await runJob("root", null, null, false, "req-1", "default");
    assertEqual(downloadedIds.length, 1, "only top level");
    assert(!downloadedIds.includes("img2"), "nested NOT reached");
  });
});

describe("Orchestrator.run - fileIds filter", () => {
  test("processes only requested fileIds, skips the rest", async () => {
    const { runJob, jobStore, downloadedIds } = buildOrchestrator({
      root: [
        { id: "keep1", name: "k1.png", isFolder: false },
        { id: "skip1", name: "s1.png", isFolder: false },
        { id: "keep2", name: "k2.png", isFolder: false },
        { id: "skip2", name: "s2.png", isFolder: false },
      ],
    });
    await runJob("root", null, null, false, "req-1", "default", ["keep1", "keep2"]);
    assertEqual(downloadedIds.length, 2, "2 matched files processed");
    assert(downloadedIds.includes("keep1") && downloadedIds.includes("keep2"), "correct files");
    const job = jobStore.get("req-1")!;
    assertEqual(job.fileIdFilter!.requested, 2, "requested 2");
    assertEqual(job.fileIdFilter!.matched, 2, "matched 2");
    assertEqual(job.fileIdFilter!.skipped, 2, "skipped 2");
  });

  test("recurses into subfolders to reach matching files deep in tree", async () => {
    const { runJob, jobStore, downloadedIds } = buildOrchestrator({
      root: [
        { id: "skipTop", name: "top.png", isFolder: false },
        { id: "sub", name: "subfolder", isFolder: true },
      ],
      sub: [{ id: "deepTarget", name: "deep.png", isFolder: false }],
    });
    await runJob("root", null, null, true, "req-1", "default", ["deepTarget"]);
    assertEqual(downloadedIds.length, 1, "only the deep target");
    assert(downloadedIds.includes("deepTarget"), "reached nested match");
    const job = jobStore.get("req-1")!;
    assertEqual(job.fileIdFilter!.matched, 1, "matched 1");
    assertEqual(job.fileIdFilter!.skipped, 1, "skipped top-level file");
  });

  test("fileIds filter skips before image-type check (no wasted download of matched non-image? still type-checked)", async () => {
    // A requested id that is a non-image still gets skipped by type check, but counts as matched.
    const { runJob, jobStore, downloadedIds } = buildOrchestrator({
      root: [
        { id: "target", name: "target.txt", isFolder: false },
        { id: "other", name: "other.png", isFolder: false },
      ],
    });
    await runJob("root", null, null, false, "req-1", "default", ["target"]);
    assertEqual(downloadedIds.length, 0, "matched file is non-image, not downloaded");
    const job = jobStore.get("req-1")!;
    assertEqual(job.fileIdFilter!.matched, 1, "target matched");
    assertEqual(job.fileIdFilter!.skipped, 1, "other skipped by fileIds");
  });
});

describe("Orchestrator.run - time range filter", () => {
  test("filters files outside [startTime, endTime]", async () => {
    const { runJob, downloadedIds } = buildOrchestrator({
      root: [
        { id: "old", name: "old.png", isFolder: false, created: 100 },
        { id: "inrange", name: "in.png", isFolder: false, created: 150 },
        { id: "new", name: "new.png", isFolder: false, created: 300 },
      ],
    });
    await runJob("root", 120, 200, false, "req-1", "default");
    assertEqual(downloadedIds.length, 1, "only in-range file");
    assert(downloadedIds.includes("inrange"), "in-range processed");
  });
});
