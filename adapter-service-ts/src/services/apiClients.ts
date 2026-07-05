import { ApiClient } from "./connections/httpClient";
import { config } from "../utils/config";
import { API_TYPES_CONFIG, METADATA_SOURCES_CONFIG } from "../utils/metadataConfig";
import { API_TYPES } from "../utils/constants";

export const cargoClient = new ApiClient({
  baseURL: config.api.baseUrl,
  headers: API_TYPES_CONFIG[API_TYPES.DEFAULT].headers,
  timeout: 30000,
}, API_TYPES_CONFIG[API_TYPES.DEFAULT].delayMs);

export const metadataClient = new ApiClient({
  baseURL: METADATA_SOURCES_CONFIG.source1.url ?? undefined,
  headers: {
    "accept": "application/json",
  },
  timeout: 30000,
}, API_TYPES_CONFIG[API_TYPES.DEFAULT].delayMs);
