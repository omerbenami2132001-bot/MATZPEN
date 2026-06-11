import { z } from "zod";

export const AdapterRequestQuerySchema = z.object({
  startTime: z.string().regex(/^\d+$/, "startTime must be UNIX timestamp").optional(),
  endTime: z.string().regex(/^\d+$/, "endTime must be UNIX timestamp").optional(),
  recursive: z.string().regex(/^(true|false)$/i, "recursive must be 'true' or 'false'"),
}).refine(
  (query) => {
    if (!query.startTime || !query.endTime) return true;
    return parseInt(query.startTime, 10) < parseInt(query.endTime, 10);
  },
  { message: "startTime must be before endTime" }
);

export const AdapterRequestParamsSchema = z.object({
  folderId: z.string().min(1, "folderId is required"),
});
