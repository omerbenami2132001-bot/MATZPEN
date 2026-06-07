import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { config } from "./config";

export class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string, apiKey: string, apiName: string, timeoutMs = 30000) {
    this.client = axios.create({
      baseURL,
      headers: {
        "X-API-Key": apiKey,
        "X-API-Name": apiName,
      },
      timeout: timeoutMs,
    });
  }

  get<T = unknown>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, options);
  }
}

export const apiClient = new ApiClient(
  config.api.baseUrl!,
  config.api.key!,
  config.api.name!
);
