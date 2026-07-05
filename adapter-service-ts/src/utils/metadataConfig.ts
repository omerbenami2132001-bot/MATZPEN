import { ZodSchema } from "zod";
import { config } from "./config";
import { CargoChildSchema } from "../schemas/cargo.schemas";
import { MetadataApi2Schema } from "../schemas/metadata.schemas";
import {
  API_TYPES,
  METADATA_API_1_PREFIX,
  METADATA_API_2_PREFIX,
  METADATA_API_2_FIELDS,
  CARGO_CHAT_PREFIX,
} from "./constants";

export type MetadataSourceType = "local" | "http" | "excel";

export interface MetadataSourceConfig {
  prefix: string;
  fields: string[];
  schema: ZodSchema | null;
  type: MetadataSourceType;
  url: string | null | undefined;
  always: boolean;
  geometryField: string | null;
}

export const METADATA_SOURCES_CONFIG: Record<string, MetadataSourceConfig> = {
  cargo: {
    prefix: METADATA_API_1_PREFIX,
    fields: ["*"],
    schema: CargoChildSchema,
    type: "local",
    url: null,
    always: true,
    geometryField: null,
  },
  source1: {
    prefix: METADATA_API_2_PREFIX,
    fields: METADATA_API_2_FIELDS,
    schema: MetadataApi2Schema,
    type: "http",
    url: config.metadata.api2Url,
    always: false,
    geometryField: "geometries",
  },
  chat: {
    prefix: CARGO_CHAT_PREFIX,
    fields: [],
    schema: null,
    type: "excel",
    url: null,
    always: false,
    geometryField: null,
  },
};

const CARGO_HEADERS = {
  "x-cargo-api-key": config.api.key,
  "x-cargo-app-name": config.api.name,
  "accept": "application/json",
};

export interface ApiTypeConfig {
  headers: Record<string, string | undefined>;
  delayMs: number;
  metadataSources: string[];
  forceRecursive: boolean;
}

export const API_TYPES_CONFIG: Record<string, ApiTypeConfig> = {
  [API_TYPES.DEFAULT]: {
    headers: CARGO_HEADERS,
    delayMs: 3500,
    metadataSources: ["source1"],
    forceRecursive: false,
  },
  [API_TYPES.CHAT]: {
    headers: CARGO_HEADERS,
    delayMs: 3500,
    metadataSources: ["chat"],
    forceRecursive: true,
  },
};
