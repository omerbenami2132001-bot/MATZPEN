import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

export class ApiClient {
  private client: AxiosInstance;
  private requestDelayMs: number;

  constructor(config: AxiosRequestConfig, requestDelayMs = 3500) {
    this.client = axios.create(config);
    this.requestDelayMs = requestDelayMs;
  }

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get<T = unknown>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
    await this.delay(this.requestDelayMs);
    return this.client.get<T>(url, options);
  }
}
