import "dotenv/config";

export const config = {
  port: process.env.PORT || 3000,
  api: {
    baseUrl: process.env.API_BASE_URL,
    key: process.env.API_KEY,
    name: process.env.API_NAME,
  },
};

export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.api.baseUrl) missing.push("API_BASE_URL");
  if (!config.api.key) missing.push("API_KEY");
  if (!config.api.name) missing.push("API_NAME");

  if (missing.length > 0) {
    console.error(`FATAL: Missing required ENV variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}
