import { ZodSchema } from "zod";

export class ValidationError extends Error {
  validationErrors: string[];

  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join("; ")}`);
    this.validationErrors = errors;
  }
}
//CR great function and can defenitly be used in other projects but 
// I think name should only be validate because default validation
// failiure is to throw 
export function validateOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  throw new ValidationError(errors);
}
