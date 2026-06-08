import { validateConfig, config, logger, STEPS } from "./src/utils";
import { S3Service, KafkaService } from "./src/services";
import express from "express";
import adapterRoute from "./src/routes/adapter.route";

validateConfig();

const app = express();

app.use("/adapter", adapterRoute);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

async function start() {
  await S3Service.getInstance().connect();
  await KafkaService.getInstance().connect();
  app.listen(config.port, () => {
    logger.log("INFO", "system", STEPS.HTTP_REQUEST, "Adapter service started", {
      port: config.port,
      health: `http://localhost:${config.port}/health`,
      trigger: `POST http://localhost:${config.port}/adapter/download/<folder-id>`,
      status: `GET http://localhost:${config.port}/adapter/status/<request-id>`,
    });
  });
}

process.on("SIGTERM", async () => { await KafkaService.getInstance().disconnect(); process.exit(0); });
process.on("SIGINT", async () => { await KafkaService.getInstance().disconnect(); process.exit(0); });

start().catch((err) => { console.error("Failed to start:", err.message); process.exit(1); });
