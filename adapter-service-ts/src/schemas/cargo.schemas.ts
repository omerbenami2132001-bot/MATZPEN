import { z } from "zod";

export const CargoChildSchema = z.object({
  id: z.preprocess((val) => String(val), z.string().min(1, "Child ID cannot be empty")),
  name: z.string().min(1, "Child name cannot be empty"),
  isFolder: z.boolean(),
  created: z.preprocess((val) => val !== undefined && val !== null ? Number(val) : undefined, z.number().int().nonnegative().optional()),
  parentId: z.string().optional(),
  mimeType: z.string().optional(),
  owner: z.string().optional(),
  description: z.string().optional(),
  childCount: z.number().int().nonnegative().optional(),
});

export type CargoChild = z.infer<typeof CargoChildSchema>;

export const FolderResponseSchema = z.object({
  children: z.array(CargoChildSchema),
});

export type FolderResponse = z.infer<typeof FolderResponseSchema>;
