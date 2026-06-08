import "dotenv/config";

export const config = {
  //CR where are all the other config variables and secrets??
  // kafka, s3 api's and so on. also we might have a lot of api's so you should split config
  // into multiple, for example cargoApi, bufonApi and so on. they should all be under apis: {}
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
