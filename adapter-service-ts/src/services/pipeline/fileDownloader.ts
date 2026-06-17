// FileDownloader — מוריד קובץ מ-API ומחזיר Base64.
import * as logger from "../../utils/logger";
import { STEPS } from "../../utils/logger";
import { withRetry } from "../../utils/retry";
import { ApiClient } from "../connections/httpClient";

export class FileDownloader {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async download(fileId: string, requestId: string) {
    const response = await withRetry(
      () => this.apiClient.get(`/files/${fileId}/download`, { responseType: "arraybuffer" }),
      { retries: 3, delayMs: 1000, label: `download ${fileId}`, requestId }
    );
    const buffer = Buffer.from(response.data as ArrayBuffer);
    logger.log("INFO", requestId, STEPS.CONVERT_FILE, "File downloaded and converted to Base64", { fileId });
    return buffer.toString("base64");
  }
}
