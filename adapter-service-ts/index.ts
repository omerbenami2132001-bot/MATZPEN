import { validateConfig, config, logger, STEPS } from "./src/utils";
import { connectAll, disconnectAll, createAdapterService } from "./src/container";
import { ACTIVE_RUN_MODE, RUN_MODE, STREAM_TOPIC } from "./src/utils/constants";
import { StreamRunner, Runner } from "./src/services/runners";
import express from "express";
import adapterRoute from "./src/routes/adapter.route";

validateConfig();

const app = express();

app.use("/adapter", adapterRoute);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

let streamRunner: Runner | null = null;

async function start() {
  await connectAll();

  app.listen(config.port, () => {
    logger.log("INFO", "system", STEPS.HTTP_REQUEST, "Adapter service started", {
      port: config.port,
      runMode: ACTIVE_RUN_MODE,
      health: `http://localhost:${config.port}/health`,
    });
  });

  // In STREAM mode, a scheduled runner opens a new batch on every aligned window.
  // In BATCH mode, runs are triggered on demand via the HTTP endpoints (no runner needed).
  if (ACTIVE_RUN_MODE === RUN_MODE.STREAM) {
    const adapterService = createAdapterService();
    streamRunner = new StreamRunner(adapterService, {
      folderId: STREAM_TOPIC,
      startTime: null,
      endTime: null,
      recursive: true,
    });
    streamRunner.start();
    logger.log("INFO", "system", STEPS.HTTP_REQUEST, "Stream runner active", { topic: STREAM_TOPIC });
  }
}

async function shutdown() {
  if (streamRunner) streamRunner.stop();
  await disconnectAll();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch((err) => { console.error("Failed to start:", err.message); process.exit(1); });
