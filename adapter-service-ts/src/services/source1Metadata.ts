import * as logger from "../utils/logger";
import { STEPS } from "../utils/logger";
import { metadataPipeline } from "../utils/normalizer";
import { withRetry } from "../utils/retry";
import { fromJson } from "../utils/fieldExtractor";
import { geometriesToWkt } from "../utils/geometry";
import { METADATA_SOURCES_CONFIG, MetadataSourceConfig } from "../utils/metadataConfig";
import { ZodSchema } from "zod";
import { ApiClient } from "./connections/httpClient";

export class Source1Metadata {
  private apiClient: ApiClient;
  private url: string | null | undefined;
  private fields: string[];
  private prefix: string;
  private schema: ZodSchema | null;
  private geometryField: string | null;

  constructor(apiClient: ApiClient, sourceConfig: MetadataSourceConfig = METADATA_SOURCES_CONFIG.source1) {
    this.apiClient = apiClient;
    this.url = sourceConfig.url;
    this.fields = sourceConfig.fields;
    this.prefix = sourceConfig.prefix;
    this.schema = sourceConfig.schema;
    this.geometryField = sourceConfig.geometryField;
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

    if (this.geometryField && extracted[this.geometryField]) {
      extracted.positions = geometriesToWkt(extracted[this.geometryField] as any[]);
      delete extracted[this.geometryField];
    }

    if (Object.keys(extracted).length === 0) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "No matching fields found", {
        prefix: this.prefix, requestedFields: this.fields, availableFields: Object.keys(response.data as Record<string, unknown>),
      });
      return {};
    }

    const result = metadataPipeline(extracted, this.prefix, this.schema);

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Metadata ready from ${this.prefix} API`, {
      prefix: this.prefix, fieldCount: Object.keys(result).length,
    });

    return result;
  }
}
