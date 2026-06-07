import { z } from "zod";

export const S3FileDocumentSchema = z.object({
  origin_id: z.string().min(1),
  source_name: z.string().min(1),
  insertion_time: z.string().datetime(),
  original_file_type: z.string().min(1),
  image_base64: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type S3FileDocument = z.infer<typeof S3FileDocumentSchema>;
 