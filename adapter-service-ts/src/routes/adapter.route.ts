import express, { Request, Response, NextFunction } from "express";
import { AdapterService, ApiClient, S3Service, JobStore } from "../services";
import { API_TYPES } from "../utils/constants";

const router = express.Router();
const service = new AdapterService(
  ApiClient.getInstance(),
  S3Service.getInstance(),
  JobStore.getInstance()
);

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
