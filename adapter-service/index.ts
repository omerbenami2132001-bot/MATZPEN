import { validateConfig, config } from "./src/utils";
import express from "express";
import adapterRoute from "./src/routes/adapter.route";
import { kafkaService } from "./src/utils/kafkaService";
import { s3Service } from "./src/utils/s3Client";

validateConfig();

const app = express();

app.use("/adapter", adapterRoute);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

async function start() {
  await s3Service.connect();       // ← קודם בודקים S3
  await kafkaService.connect();    // ← אחרי זה Kafka
  app.listen(config.port, () => {  // ← רק אם שניהם עובדים — מתחילים לקבל בקשות
    console.log(`Adapter service running on http://localhost:${config.port}`);
    console.log(`Health:  http://localhost:${config.port}/health`);
    console.log(`Trigger: POST http://localhost:${config.port}/adapter/download/<folder-id>`);
    console.log(`Status:  GET  http://localhost:${config.port}/adapter/status/<request-id>`);
  });
}

process.on("SIGTERM", async () => { await kafkaService.disconnect(); process.exit(0); });
process.on("SIGINT", async () => { await kafkaService.disconnect(); process.exit(0); });

start().catch((err) => { console.error("Failed to start:", err.message); process.exit(1); });
