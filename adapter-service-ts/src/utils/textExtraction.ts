import { point } from "@turf/turf";
import { GeoJSONPoint } from "wellknown";
import { latLon, TM9toLatLon, UTMtoLatLon } from "./latLonExtraction";

interface PointConfig {
  regex: RegExp;
  lonLatExtractor: (match: RegExpExecArray) => latLon;
}

const positionPatterns: Record<string, PointConfig> = {
  "plainCoordinates": {
    "regex": /\b(\d{6})\s*[:/ ]\s*(\d{6})\b/g,
    "lonLatExtractor": TM9toLatLon,
  },
  "UTM": {
    "regex": /WGS84.?UTM\s+(\d{1,2})N\s+(\d+(?:\.\d+)?)\s*E\s*[ /,]?\s*(\d+(?:\.\d+)?)\s*N/g,
    "lonLatExtractor": UTMtoLatLon,
  },
};

const objectCommandNamePrefixes = ["מיקום"];
const objectCommandNamePatterns = new RegExp(`(?:${objectCommandNamePrefixes.join("|")})\\s*(\\d{4})\\b`, "g");

const getAllMatchesAndProcess = (message: string, patterns: RegExp, manipulation: (match: RegExpExecArray) => any) =>
  [...message.matchAll(patterns)].map((match) => manipulation(match));

export const getPoints = (message: string) => {
  let points: GeoJSONPoint[] = [];

  Object.entries(positionPatterns).forEach(([formatName, { regex, lonLatExtractor }]) => {
    points.push(...getAllMatchesAndProcess(message, regex, (match: RegExpExecArray) => point(lonLatExtractor(match))["geometry"] as GeoJSONPoint));
  });

  return points;
};

export const getObjectCommandNames = (message: string) =>
  getAllMatchesAndProcess(message, objectCommandNamePatterns, (match: RegExpExecArray) => Number(match[1]));
