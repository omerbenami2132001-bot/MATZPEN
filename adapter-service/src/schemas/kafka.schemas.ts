import { z } from "zod";

export const SourceEnum = z.enum(["adapter-service"]);

export const KafkaMessageSchema = z.object({
  source: SourceEnum,
  path: z.string().min(1),
  bucket: z.string().min(1),
  message: z.string().min(1),
  request_id: z.string().uuid(),
});

export type KafkaMessage = z.infer<typeof KafkaMessageSchema>;
