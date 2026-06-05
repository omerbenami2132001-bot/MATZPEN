import { z } from "zod";
import { ChildSchema } from "./api.schemas";

// ============================================
// Metadata validation schemas
// ============================================

// API 1 (prefix "ex") — ChildSchema
// הdata מגיע מ-folder listing, כבר עבר validation שם
// מוגדר פה בשביל תיעוד — בפועל null כי לא צריך לבדוק פעמיים
export const MetadataApi1Schema = ChildSchema;

// API 2 (prefix "ab") — Position WKT
const WKT_POINT_REGEX = /^POINT\(\s*-?\d+\.?\d*\s+-?\d+\.?\d*\s*\)$/;

export const MetadataApi2Schema = z.record(z.string(), z.unknown()).refine(
  (data) => {
    const position = data.Position || data.position;
    if (!position) return false;
    if (typeof position !== "string") return false;
    return WKT_POINT_REGEX.test(position);
  },
  { message: "Position must be WKT format: POINT(longitude latitude)" }
);
