import { ZodSchema } from "zod";

export class ValidationError extends Error {
  validationErrors: string[];

  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join("; ")}`);
    this.validationErrors = errors;
  }
}

export function validateOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const errors = result.error.issues.map(({ path, message }) => {
    const prefix = path.length > 0 ? `${path.join(".")}: ` : "";
    return `${prefix}${message}`;
  });

  throw new ValidationError(errors);
}
