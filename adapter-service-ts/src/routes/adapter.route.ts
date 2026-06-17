import express, { Request, Response, NextFunction } from "express";
import { AdapterService, ApiClient, S3Service, JobStore } from "../services";
import { Orchestrator } from "../services/orchestrator";
import { FileDownloader, MetadataCollector, Publisher } from "../services/pipeline";
import { API_TYPES } from "../utils/constants";

const apiClient = ApiClient.getInstance();
const s3Service = S3Service.getInstance();
const jobStore = JobStore.getInstance();

const downloader = new FileDownloader(apiClient);
const metadataCollector = new MetadataCollector();
const publisher = new Publisher(s3Service);
const orchestrator = new Orchestrator(apiClient, jobStore, downloader, metadataCollector, publisher);

const service = new AdapterService(jobStore, orchestrator);

const router = express.Router();

router.post("/download/:folderId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { statusCode, body } = service.handleIngest(
      req.query as Record<string, string>,
      req.params as Record<string, string>,
      API_TYPES.DEFAULT
    );
    res.status(statusCode).json(body);
  } catch (err) {
    next(err);
  }
});

router.post("/chat/:folderId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { statusCode, body } = service.handleIngest(
      { ...req.query as Record<string, string>, recursive: "true" },
      req.params as Record<string, string>,
      API_TYPES.CHAT
    );
    res.status(statusCode).json(body);
  } catch (err) {
    next(err);
  }
});

router.get("/status/:requestId", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { statusCode, body } = service.handleStatus(req.params.requestId as string);
    res.status(statusCode).json(body);
  } catch (err) {
    next(err);
  }
});

export default router;
