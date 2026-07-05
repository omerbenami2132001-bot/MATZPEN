import express, { Request, Response, NextFunction } from "express";
import { createAdapterService } from "../container";
import { API_TYPES } from "../utils/constants";
import { API_TYPES_CONFIG } from "../utils/metadataConfig";

const service = createAdapterService();
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

router.post("/cargo_chat/:folderId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = API_TYPES_CONFIG[API_TYPES.CHAT].forceRecursive
      ? { ...req.query as Record<string, string>, recursive: "true" }
      : req.query as Record<string, string>;
    const { statusCode, body } = service.handleIngest(
      query,
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
