import { ApiClient } from "./connections/httpClient";
import { config } from "../utils/config";

export const cargoClient = new ApiClient({
  baseURL: config.api.baseUrl,
  headers: {
    "x-cargo-api-key": config.api.key,
    "x-cargo-app-name": config.api.name,
    "accept": "application/json",
  },
  timeout: 30000,
});

export const metadataClient = new ApiClient({
  baseURL: config.metadata.api2Url,
  headers: {
    "accept": "application/json",
  },
  timeout: 30000,
});
