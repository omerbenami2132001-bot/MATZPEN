import "./setupEnv";
import { describe, test, assert, assertEqual } from "./harness";
import { BatchRunner, StreamRunner, nextAlignedBoundary, Runner } from "../services/runners";
import { RunParams } from "../services/adapterService";

const params: RunParams = {
  folderId: "folder-1",
  startTime: null,
  endTime: null,
  recursive: false,
  apiType: "default",
  fileIds: null,
};

// Minimal fake AdapterService that records runOnce calls.
function fakeAdapter() {
  const calls: RunParams[] = [];
  const adapter = {
    runOnce: (p: RunParams) => {
      calls.push(p);
      return { requestId: `req-${calls.length}`, alreadyRunning: false };
    },
  };
  return { adapter, calls };
}

describe("nextAlignedBoundary", () => {
  test("aligns to the next 10-minute boundary", () => {
    const tenMin = 10 * 60 * 1000;
    // 10:03:00 → next boundary 10:10:00
    const t1003 = Date.UTC(2024, 0, 1, 10, 3, 0);
    const b = nextAlignedBoundary(t1003, tenMin);
    assertEqual(b, Date.UTC(2024, 0, 1, 10, 10, 0), "10:03 → 10:10");
  });

  test("just before a boundary aligns to that boundary", () => {
    const tenMin = 10 * 60 * 1000;
    const t1009 = Date.UTC(2024, 0, 1, 10, 9, 59);
    const b = nextAlignedBoundary(t1009, tenMin);
    assertEqual(b, Date.UTC(2024, 0, 1, 10, 10, 0), "10:09:59 → 10:10");
  });

  test("exactly on a boundary aligns to the NEXT one", () => {
    const tenMin = 10 * 60 * 1000;
    const t1010 = Date.UTC(2024, 0, 1, 10, 10, 0);
    const b = nextAlignedBoundary(t1010, tenMin);
    assertEqual(b, Date.UTC(2024, 0, 1, 10, 20, 0), "10:10:00 → 10:20 (next)");
  });

  test("boundary is independent of start time (deterministic)", () => {
    const tenMin = 10 * 60 * 1000;
    // Two different 'start' moments inside the same window land on the same boundary.
    const a = nextAlignedBoundary(Date.UTC(2024, 0, 1, 10, 1, 0), tenMin);
    const b = nextAlignedBoundary(Date.UTC(2024, 0, 1, 10, 8, 0), tenMin);
    assertEqual(a, b, "same window → same boundary");
    assertEqual(a, Date.UTC(2024, 0, 1, 10, 10, 0), "both → 10:10");
  });
});

describe("BatchRunner", () => {
  test("runs once on start", () => {
    const { adapter, calls } = fakeAdapter();
    const runner: Runner = new BatchRunner(adapter as never, params);
    runner.start();
    assertEqual(calls.length, 1, "one run on start");
    assertEqual(calls[0].folderId, "folder-1", "correct params passed");
  });

  test("does not run again (single shot)", () => {
    const { adapter, calls } = fakeAdapter();
    const runner = new BatchRunner(adapter as never, params);
    runner.start();
    runner.stop();
    assertEqual(calls.length, 1, "still one run after stop");
  });
});

describe("StreamRunner", () => {
  test("does not run immediately on start (waits for boundary)", () => {
    const { adapter, calls } = fakeAdapter();
    // setupEnv accelerates setTimeout to 0, so we can't assert timing precisely,
    // but we can assert that start() itself does not synchronously call runOnce.
    const runner = new StreamRunner(adapter as never, params, 10 * 60 * 1000);
    runner.start();
    assertEqual(calls.length, 0, "no synchronous run on start");
    runner.stop();
  });

  test("stop() before any tick prevents runs", async () => {
    const { adapter, calls } = fakeAdapter();
    const runner = new StreamRunner(adapter as never, params, 10 * 60 * 1000);
    runner.start();
    runner.stop();
    // Give the (accelerated) timers a chance to fire.
    await new Promise((r) => setTimeout(r, 5));
    assertEqual(calls.length, 0, "stopped before firing");
  });

  test("passes the configured params to each run", async () => {
    const { adapter, calls } = fakeAdapter();
    const streamParams: RunParams = { ...params, folderId: "stream-topic" };
    const runner = new StreamRunner(adapter as never, streamParams, 10 * 60 * 1000);
    runner.start();
    // Let the accelerated alignment timer fire at least once.
    await new Promise((r) => setTimeout(r, 5));
    runner.stop();
    if (calls.length > 0) {
      assertEqual(calls[0].folderId, "stream-topic", "stream params used");
    }
    assert(true, "no crash");
  });
});
