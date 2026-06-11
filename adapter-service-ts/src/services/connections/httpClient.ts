import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { config } from "../../utils/config";

export class ApiClient {
  private static instance: ApiClient;
  private client: AxiosInstance;

  private constructor(baseURL: string, apiKey: string, apiName: string, timeoutMs = 30000) {
    this.client = axios.create({
      baseURL,
      headers: {
        "x-api-key": apiKey,
        "x-api-name": apiName,
        "accept": "application/json",
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

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get<T = unknown>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
    await this.delay(1000);
    console.log("REQUEST:", this.client.defaults.baseURL + url);
    return this.client.get<T>(url, options);
  }
}
