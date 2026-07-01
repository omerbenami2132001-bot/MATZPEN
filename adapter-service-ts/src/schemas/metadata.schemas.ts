import { z } from "zod";

export const MetadataApi2Schema = z.object({
  contentData: z.object({
    Position: z.string().refine(
      (val) => {
        const trimmed = val.trim();
        const wktPattern = /^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s/i;
        return wktPattern.test(trimmed);
      },
      { message: "Position must be a valid WKT geometry string (e.g., POINT (x y))" }
    ),
  }).catchall(z.unknown()),
}).catchall(z.unknown());
