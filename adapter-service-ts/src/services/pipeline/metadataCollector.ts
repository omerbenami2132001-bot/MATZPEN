import { CargoMetadata } from "../cargoMetadata";
import { Source1Metadata } from "../source1Metadata";
import { CargoChatMetadata } from "../cargoChatMetadata";
import { API_TYPES } from "../../utils/constants";
import { MetadataSource, FileInfo } from "../../types";
import { metadataClient } from "../apiClients";

export const METADATA_SOURCES: Record<string, MetadataSource[]> = {
  [API_TYPES.DEFAULT]: [new Source1Metadata(metadataClient)],
  [API_TYPES.CHAT]: [new CargoChatMetadata()],
};

export class MetadataCollector {
  private cargoMetadata: CargoMetadata;

  constructor() {
    this.cargoMetadata = new CargoMetadata();
  }

  async collect(fileInfo: FileInfo, fileId: string, requestId: string, apiType: string) {
    const cargoData = this.cargoMetadata.processCargo(fileInfo as Record<string, unknown>, requestId);
    const sources = METADATA_SOURCES[apiType] || METADATA_SOURCES[API_TYPES.DEFAULT];
    const additional = await Promise.all(
      sources.map((source) => source.process(fileId, requestId, fileInfo as Record<string, unknown>))
    );
    return Object.assign({}, cargoData, ...additional);
  }

  getSources(apiType: string) {
    return METADATA_SOURCES[apiType] || METADATA_SOURCES[API_TYPES.DEFAULT];
  }
}
