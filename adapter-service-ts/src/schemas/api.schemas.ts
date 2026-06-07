import { z } from "zod";

export const ChildSchema = z.object({
  id: z.string().min(1, "Child ID cannot be empty"),
  name: z.string().min(1, "Child name cannot be empty"),
  isFolder: z.boolean(),
  created: z.number().int().nonnegative().optional(),
  parentId: z.string().optional(),
  mimeType: z.string().optional(),
  owner: z.string().optional(),
  description: z.string().optional(),
  childCount: z.number().int().nonnegative().optional(),
});

export type Child = z.infer<typeof ChildSchema>;

export const FolderResponseSchema = z.object({
  children: z.array(ChildSchema),
});

export type FolderResponse = z.infer<typeof FolderResponseSchema>;
