import { S3Service } from "./services/connections/s3Client";
import { KafkaService } from "./services/connections/kafkaService";
import { JobStore } from "./services/jobStore";
import { Orchestrator } from "./services/orchestrator";
import { AdapterService } from "./services/adapterService";
import { FileDownloader, MetadataCollector, Publisher } from "./services/pipeline";
import { cargoClient } from "./services/apiClients";

export function createAdapterService(): AdapterService {
  const s3Service = S3Service.getInstance();
  const jobStore = JobStore.getInstance();

  const downloader = new FileDownloader(cargoClient);
  const metadataCollector = new MetadataCollector();
  const publisher = new Publisher(s3Service);

  const orchestrator = new Orchestrator(cargoClient, jobStore, downloader, metadataCollector, publisher);

  return new AdapterService(jobStore, orchestrator);
}

export async function connectAll(): Promise<void> {
  await S3Service.getInstance().connect();
  await KafkaService.getInstance().connect();
}

export async function disconnectAll(): Promise<void> {
  await KafkaService.getInstance().disconnect();
}
