import { AdapterService, RunParams } from "./adapterService";
import { STREAM_INTERVAL_MS } from "../utils/constants";
import { logger } from "../utils";
import { STEPS } from "../utils/logger";

/**
 * A Runner decides WHEN a run happens. The Job itself stays generic and does
 * not know whether it was triggered on demand (batch) or on a schedule (stream).
 */
export interface Runner {
  start(): void;
  stop(): void;
}

/**
 * Batch runner: triggers a single run on demand and then stops. This mirrors the
 * existing HTTP-triggered behaviour — start once, run once.
 */
export class BatchRunner implements Runner {
  constructor(
    private readonly adapterService: AdapterService,
    private readonly params: RunParams
  ) {}

  start(): void {
    this.adapterService.runOnce(this.params);
  }

  stop(): void {
    // Nothing to stop — a batch run is a single shot.
  }
}

/**
 * Computes the next wall-clock-aligned boundary for a given interval.
 * Windows are aligned to the epoch so they are deterministic and independent of
 * when the service started or which instance is running (e.g. 10:00, 10:10, 10:20).
 */
export const nextAlignedBoundary = (now: number, intervalMs: number): number => {
  return Math.ceil((now + 1) / intervalMs) * intervalMs;
};

/**
 * Stream runner: opens a new batch on every fixed, wall-clock-aligned window
 * (e.g. every 10 minutes at :00, :10, :20). Each window is an independent run
 * (interpretation 2): it calls runOnce, which creates its own job. Runs may
 * overlap — a slow window can still be finishing while the next one starts —
 * because each is a separate job with its own requestId.
 */
export class StreamRunner implements Runner {
  private timer: NodeJS.Timeout | null = null;
  private alignmentTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly adapterService: AdapterService,
    private readonly params: RunParams,
    private readonly intervalMs: number = STREAM_INTERVAL_MS
  ) {}

  start(): void {
    // Align the first tick to the next round boundary, then tick every interval.
    const now = Date.now();
    const firstBoundary = nextAlignedBoundary(now, this.intervalMs);
    const delayToFirst = firstBoundary - now;

    logger.log("INFO", "stream", STEPS.HTTP_REQUEST, "Stream runner starting", {
      intervalMs: this.intervalMs,
      firstBoundaryInMs: delayToFirst,
    });

    this.alignmentTimer = setTimeout(() => {
      this.tick();
      this.timer = setInterval(() => this.tick(), this.intervalMs);
    }, delayToFirst);
  }

  stop(): void {
    if (this.alignmentTimer) {
      clearTimeout(this.alignmentTimer);
      this.alignmentTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    // Each window is an independent run with its own job (interpretation 2).
    this.adapterService.runOnce(this.params);
  }
}
