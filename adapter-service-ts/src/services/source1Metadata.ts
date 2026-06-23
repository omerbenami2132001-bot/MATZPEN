import * as logger from "../utils/logger";
import { STEPS } from "../utils/logger";
import { metadataPipeline } from "../utils/normalizer";
import { withRetry } from "../utils/retry";
import { fromJson } from "../utils/fieldExtractor";
import { geometriesToWkt } from "../utils/geometryToWkt";
import { METADATA_API_2_PREFIX, METADATA_API_2_FIELDS } from "../utils/constants";
import { config } from "../utils/config";
import { MetadataApi2Schema } from "../schemas";
import { ApiClient } from "./connections/httpClient";

export class Source1Metadata {
  private apiClient: ApiClient;
  private url: string | undefined;
  private fields: string[];
  private prefix: string;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
    this.url = config.metadata.api2Url;
    this.fields = METADATA_API_2_FIELDS;
    this.prefix = METADATA_API_2_PREFIX;
  }

  private stripExtension(filename: string) {
    const lastDot = filename.lastIndexOf(".");
    return lastDot > 0 ? filename.substring(0, lastDot) : filename;
  }

  async process(fileId: string, requestId: string, fileInfo?: Record<string, unknown>) {
    if (!this.url) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "Source1 API URL not configured, skipping");
      return {};
    }

    const fileName = String(fileInfo?.name || "");
    const lookupKey = this.stripExtension(fileName);

    if (!lookupKey) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "Source1: no filename, skipping", { fileId });
      return {};
    }

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Fetching metadata from ${this.prefix} API`, {
      lookupKey, fields: this.fields, prefix: this.prefix,
    });

    const response = await withRetry(
      () => this.apiClient.get(`/${lookupKey}`),
      { retries: 3, delayMs: 1000, label: `metadata ${this.prefix} API`, requestId }
    );

    const extracted = fromJson(response.data as Record<string, unknown>, this.fields);

    if (extracted.geometries) {
      extracted.positions = geometriesToWkt(extracted.geometries as any[]);
      delete extracted.geometries;
    }

    if (Object.keys(extracted).length === 0) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "No matching fields found", {
        prefix: this.prefix, requestedFields: this.fields, availableFields: Object.keys(response.data as Record<string, unknown>),
      });
      return {};
    }

    const result = metadataPipeline(extracted, this.prefix, MetadataApi2Schema);

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Metadata ready from ${this.prefix} API`, {
      prefix: this.prefix, fieldCount: Object.keys(result).length,
    });

    return result;
  }
}
