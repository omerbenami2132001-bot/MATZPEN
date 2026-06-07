//CR you should use index files for cleaner imports. for example if you have a folder like utils that has a lot of imports
import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils";
import { ValidationError } from "../utils/validation";
import { STEPS } from "../utils/logger";
import { apiClient } from "../utils/httpClient";
import { s3Service } from "../utils/s3Client";
import { metadataClient } from "../utils/metadataClient";
import { jobStore } from "../utils/jobStore";
import { AdapterProcessor } from "../utils/adapterProcessor";

const router = express.Router();
const processor = new AdapterProcessor(apiClient, s3Service, metadataClient, jobStore);

// ============================================
// POST /adapter/download/:folderId
// ============================================
//CR routers shouldn't have nl in them even if its simple steps like validating or handling job
// you should create an AdapterService to handle all of these (even if it looks a little weird at first)
router.post("/download/:folderId", async (req: Request, res: Response) => {
  //CR maybe generate requestId in middleware so it would be for all routes?
  const requestId = uuidv4();
  logger.log("INFO", requestId, STEPS.HTTP_REQUEST, "Request received", { method: req.method, path: req.originalUrl });

  try {
    logger.log("INFO", requestId, STEPS.VALIDATE_INPUT, "Validating request");

    const { folderId, startTime, endTime, recursive } = AdapterProcessor.validateRequest(
      {
        "x-start-time": req.headers["x-start-time"] as string,
        "x-end-time": req.headers["x-end-time"] as string,
        "x-recursive": req.headers["x-recursive"] as string,
      },
      req.params as Record<string, string>
    );

    const existingJobId = jobStore.findRunning(folderId, startTime, endTime);
    if (existingJobId) {
      logger.log("WARN", requestId, STEPS.HTTP_REQUEST, "Job already running", { folderId, existingJobId });
      return res.status(409).json(jobStore.toConflictResponse(existingJobId));
    }

    jobStore.create(requestId, folderId, { startTime, endTime, recursive });
    processor.run(folderId, startTime, endTime, recursive, requestId);

    res.status(202).json(jobStore.toCreatedResponse(requestId, folderId));
  } catch (err) {
    logger.log("ERROR", requestId, STEPS.HTTP_RESPONSE, "Request failed", err);
    const statusCode = err instanceof ValidationError ? 422 : 500;
    res.status(statusCode).json({ success: false, error: (err as Error).message, requestId });
  }
});

// ============================================
// GET /adapter/status/:requestId
// ============================================

router.get("/status/:requestId", (req: Request, res: Response) => {
  const requestId = req.params.requestId as string;
  const response = jobStore.toResponse(requestId);

  if (!response) {
    return res.status(404).json({ success: false, error: "Job not found", requestId });
  }

  res.json(response);
});

export default router;
