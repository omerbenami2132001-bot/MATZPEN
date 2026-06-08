export class ValidationError extends Error {
  validationErrors: string[];

  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join("; ")}`);
    this.validationErrors = errors;
  }
}
