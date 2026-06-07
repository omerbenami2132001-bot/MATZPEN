import express, { Request, Response } from "express"; 
import { apiClient } from "../utils/httpClient";
import { s3Service } from "../utils/s3Client";
import { metadataClient } from "../utils/metadataClient";
import { jobStore } from "../utils/jobStore";
import { AdapterService } from "../utils/adapterService";

const router = express.Router();
const service = new AdapterService(apiClient, s3Service, metadataClient, jobStore);

router.post("/download/:folderId", async (req: Request, res: Response) => {
  const { statusCode, body } = service.handleIngest(
    {
      "x-start-time": req.headers["x-start-time"] as string,
      "x-end-time": req.headers["x-end-time"] as string,
      "x-recursive": req.headers["x-recursive"] as string,
    },
    req.params as Record<string, string>
  );
  res.status(statusCode).json(body);
});

router.get("/status/:requestId", (req: Request, res: Response) => {
  const { statusCode, body } = service.handleStatus(req.params.requestId as string);
  res.status(statusCode).json(body);
});

export default router;
