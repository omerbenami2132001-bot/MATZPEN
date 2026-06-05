import axios from "axios";
import * as logger from "./logger";
import { STEPS } from "./logger";
import { validateOrThrow } from "./validation";
import { normalizeObject } from "./normalizer";
import { withRetry } from "./retry";
import {
  METADATA_API_1_PREFIX,
  METADATA_API_2_PREFIX, METADATA_API_2_FIELDS,
} from "./constants";
import { MetadataApi1Schema, MetadataApi2Schema } from "../schemas";
import { ZodSchema } from "zod";

interface ApiConfig {
  url: string | undefined;
  fields: string[];
  prefix: string;
  schema: ZodSchema | null;
}

export class MetadataClient {
  private apis: ApiConfig[];

  constructor(apis: ApiConfig[]) {
    this.apis = apis;
  }

  // ============================================
  // Static utilities — used by pipeline + tests
  // ============================================

  static flattenWithPrefix(data: Record<string, unknown>, prefix: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[`${prefix}_${key}`] = value;
    }
    return result;
  }

  static extractFields(responseData: Record<string, unknown>, fields: string[]): Record<string, unknown> {
    let merged: Record<string, unknown> = {};

    for (const fieldSpec of fields) {
      if (fieldSpec === "*") {
        merged = { ...merged, ...responseData };
        continue;
      }

      const shouldUnpack = fieldSpec.endsWith("*");
      const field = shouldUnpack ? fieldSpec.slice(0, -1) : fieldSpec;

      const value = responseData[field];
      if (value === undefined || value === null) continue;

      if (shouldUnpack && typeof value === "object" && !Array.isArray(value)) {
        merged = { ...merged, ...(value as Record<string, unknown>) };
      } else {
        merged[field] = value;
      }
    }

    return merged;
  }

  // ============================================
  // Pipeline — validate → normalize → flatten
  // כתוב פעם אחת, נקרא מ-processCar ומ-fetchOne
  // ============================================

  private pipeline(data: Record<string, unknown>, prefix: string, schema: ZodSchema | null, requestId: string): Record<string, unknown> {
    let validated = data;
    if (schema) {
      validated = validateOrThrow(schema, data) as Record<string, unknown>;
    }

    const normalized = normalizeObject(validated);
    return MetadataClient.flattenWithPrefix(normalized, prefix);
  }

  // ============================================
  // processCar — data כבר בזיכרון, בלי HTTP
  // ============================================

  processCar(data: Record<string, unknown>, prefix: string, schema: ZodSchema | null, requestId: string): Record<string, unknown> {
    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Processing local metadata for ${prefix}`, {
      prefix, fieldCount: Object.keys(data).length,
    });

    const result = this.pipeline(data, prefix, schema, requestId);

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Local metadata ready for ${prefix}`, {
      prefix, fieldCount: Object.keys(result).length,
    });

    return result;
  }

  // ============================================
  // fetchOne — HTTP GET → extract → pipeline
  // ============================================

  async fetchOne(url: string, fileId: string, fields: string[], prefix: string, schema: ZodSchema | null, requestId: string): Promise<Record<string, unknown>> {
    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Fetching metadata from ${prefix} API`, {
      url, fileId, fields, prefix,
    });

    const response = await withRetry(
      () => axios.get(`${url}/${fileId}`),
      { retries: 3, delayMs: 1000, label: `metadata ${prefix} API`, requestId }
    );

    const extracted = MetadataClient.extractFields(response.data, fields);

    if (Object.keys(extracted).length === 0) {
      logger.log("WARN", requestId, STEPS.FETCH_METADATA, "No matching fields found", {
        prefix, requestedFields: fields, availableFields: Object.keys(response.data),
      });
      return {};
    }

    const result = this.pipeline(extracted, prefix, schema, requestId);

    logger.log("INFO", requestId, STEPS.FETCH_METADATA, `Metadata ready from ${prefix} API`, {
      prefix, fieldCount: Object.keys(result).length,
    });

    return result;
  }

  // ============================================
  // fetchAll — מרכז: local (ex) + HTTP (ab+)
  // ============================================

  async fetchAll(fileId: string, requestId: string, childData: Record<string, unknown>): Promise<Record<string, unknown>> {
    let metadata: Record<string, unknown> = {};

    // API 1: child data שכבר בזיכרון
    const localMetadata = this.processCar(childData, METADATA_API_1_PREFIX, MetadataApi1Schema, requestId);
    metadata = { ...metadata, ...localMetadata };

    // API 2+: HTTP
    for (const api of this.apis) {
      if (!api.url) continue;
      const data = await this.fetchOne(api.url, fileId, api.fields, api.prefix, api.schema, requestId);
      metadata = { ...metadata, ...data };
    }

    return metadata;
  }
}

// Singleton
export const metadataClient = new MetadataClient([
  { url: process.env.METADATA_API_2_URL, fields: METADATA_API_2_FIELDS, prefix: METADATA_API_2_PREFIX, schema: MetadataApi2Schema },
]);
