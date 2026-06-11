import express, { Request, Response } from "express";
import { AdapterService, ApiClient, S3Service, JobStore } from "../services";

const router = express.Router();
const service = new AdapterService(
  ApiClient.getInstance(),
  S3Service.getInstance(),
  JobStore.getInstance()
);

router.post("/download/:folderId", async (req: Request, res: Response) => {
  const { statusCode, body } = service.handleIngest(
    req.query as Record<string, string>,
    req.params as Record<string, string>,
    "default"
  );
  res.status(statusCode).json(body);
});

router.post("/chat/:folderId", async (req: Request, res: Response) => {
  const { statusCode, body } = service.handleIngest(
    { ...req.query as Record<string, string>, recursive: "true" },
    req.params as Record<string, string>,
    "chat"
  );
  res.status(statusCode).json(body);
});

router.get("/status/:requestId", (req: Request, res: Response) => {
  const { statusCode, body } = service.handleStatus(req.params.requestId as string);
  res.status(statusCode).json(body);
});

export default router;
