import { z } from "zod";
//CR why not have them in query params?
export const AdapterRequestHeadersSchema = z.object({
  "x-start-time": z.string().regex(/^\d+$/, "x-start-time must be UNIX timestamp"),
  "x-end-time": z.string().regex(/^\d+$/, "x-end-time must be UNIX timestamp"),
  "x-recursive": z.string().regex(/^(true|false)$/i, "x-recursive must be 'true' or 'false'"),
}).refine(
  (headers) => parseInt(headers["x-start-time"], 10) < parseInt(headers["x-end-time"], 10),
  { message: "x-start-time must be before x-end-time" }
);

export const AdapterRequestParamsSchema = z.object({
  folderId: z.string().min(1, "folderId is required"),
});
