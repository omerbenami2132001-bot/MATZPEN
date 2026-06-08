import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { config } from "./config";

//you should use Akiva's apiClient
// it alread
export class ApiClient {
  private client: AxiosInstance;
//CR apiKey should be instead apiKeyHeader so that if different api's want different ways of auth
// you can still use this class

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
//CR why have it here? what if you have 
export const apiClient = new ApiClient(
  config.api.baseUrl!,
  config.api.key!,
  config.api.name!
);
