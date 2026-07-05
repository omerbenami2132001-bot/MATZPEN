import { CargoMetadata } from "../cargoMetadata";
import { Source1Metadata } from "../source1Metadata";
import { CargoChatMetadata } from "../cargoChatMetadata";
import { API_TYPES } from "../../utils/constants";
import { API_TYPES_CONFIG, METADATA_SOURCES_CONFIG } from "../../utils/metadataConfig";
import { MetadataSource, FileInfo } from "../../types";
import { metadataClient } from "../apiClients";
import { groupExtractedMetadata } from "../../utils/extractedMetadataConfig";

const SOURCE_BUILDERS: Record<string, () => MetadataSource> = {
  source1: () => new Source1Metadata(metadataClient, METADATA_SOURCES_CONFIG.source1),
  chat: () => new CargoChatMetadata(groupExtractedMetadata, METADATA_SOURCES_CONFIG.chat),
};

const buildSources = (names: string[]): MetadataSource[] =>
  names.map((name) => SOURCE_BUILDERS[name]()).filter(Boolean);

export const METADATA_SOURCES: Record<string, MetadataSource[]> = Object.fromEntries(
  Object.keys(API_TYPES_CONFIG).map((apiType) => [apiType, buildSources(API_TYPES_CONFIG[apiType].metadataSources)])
);

export class MetadataCollector {
  private cargoMetadata: CargoMetadata;

  constructor() {
    this.cargoMetadata = new CargoMetadata();
  }

  async collect(fileInfo: FileInfo, fileId: string, requestId: string, apiType: string) {
    const cargoData = this.cargoMetadata.processCargo(fileInfo as Record<string, unknown>, requestId);
    const sources = this.getSources(apiType);
    const additional = await Promise.all(
      sources.map((source) => source.process(fileId, requestId, fileInfo as Record<string, unknown>))
    );
    return Object.assign({}, cargoData, ...additional);
  }

  getSources(apiType: string): MetadataSource[] {
    return METADATA_SOURCES[apiType] || METADATA_SOURCES[API_TYPES.DEFAULT];
  }
}
