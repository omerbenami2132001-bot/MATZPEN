import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { config } from "../../utils/config";

export class ApiClient {
  private static instance: ApiClient;
  private client: AxiosInstance;

  private constructor(baseURL: string, apiKey: string, apiName: string, timeoutMs = 30000) {
    this.client = axios.create({
      baseURL,
      headers: {
        "X-API-Key": apiKey,
        "X-API-Name": apiName,
      },
      timeout: timeoutMs,
    });
  }

  static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient(
        config.api.baseUrl!,
        config.api.key!,
        config.api.name!
      );
    }
    return ApiClient.instance;
  }

  get<T = unknown>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, options);
  }
}
