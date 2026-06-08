// Source1Metadata — שולף metadata מ-API 2 (HTTP).
import axios from "axios";
import * as logger from "../utils/logger";
import { STEPS } from "../utils/logger";
import { metadataPipeline } from "../utils/normalizer";
import { withRetry } from "../utils/retry";
import { fromJson } from "../utils/fieldExtractor";
import { METADATA_API_2_PREFIX, METADATA_API_2_FIELDS } from "../utils/constants";
import { config } from "../utils/config";
import { MetadataApi2Schema } from "../schemas";

export class Source1Metadata {
  private url: string | undefined;
  private fields: string[];
  private prefix: string;

  constructor() {
    this.url = config.metadata.api2Url;
    this.fields = METADATA_API_2_FIELDS;
    this.prefix = METADATA_API_2_PREFIX;
  }

  async process(fileId: string, requestId: string) {
    if (!this.url) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "Source1 API URL not configured, skipping");
      return {};
    }

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Fetching metadata from ${this.prefix} API`, {
      url: this.url, fileId, fields: this.fields, prefix: this.prefix,
    });

    const response = await withRetry(
      () => axios.get(`${this.url}/${fileId}`),
      { retries: 3, delayMs: 1000, label: `metadata ${this.prefix} API`, requestId }
    );

    const extracted = fromJson(response.data, this.fields);

    if (Object.keys(extracted).length === 0) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "No matching fields found", {
        prefix: this.prefix, requestedFields: this.fields, availableFields: Object.keys(response.data),
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
