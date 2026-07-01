import { GeoJSONPoint, stringify } from "wellknown";
import { getObjectCommandNames, getPoints } from "./textExtraction";
import { combinePoints } from "./geometry";

export interface ExtractedMetadataConfig {
  extractors: Record<string, (message: string) => any>;
  postProcessors: Record<string, (extracted: any[]) => any>;
}

export const groupExtractedMetadata: { [chatGroupName: string]: ExtractedMetadataConfig } = {
  "חמ\"ל": {
    "extractors": {
      "position": getPoints,
      "objectCommandName": getObjectCommandNames,
    },
    "postProcessors": {
      "position": (points: GeoJSONPoint[]) => { const geo = combinePoints(points); return geo ? stringify(geo) : null; },
      "objectCommandName": (objectCommandNames: number[]) => objectCommandNames.length ? [... new Set(objectCommandNames)] : null,
    },
  },
};
