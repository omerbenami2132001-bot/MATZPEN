import { z } from "zod";


const WKT_REGEX = /^(POINT|LINESTRING|POLYGON|MULTIPOINT)\s*\(.+\)$/;

export const MetadataApi2Schema = z.record(z.string(), z.unknown()).refine(
  (data) => {
    const positions = data.positions;
    if (!Array.isArray(positions)) return false;
    if (positions.length === 0) return false;
    return positions.some((pos) => typeof pos === "string" && WKT_REGEX.test(pos));
  },
  { message: "positions must contain at least one valid WKT geometry" }
);
