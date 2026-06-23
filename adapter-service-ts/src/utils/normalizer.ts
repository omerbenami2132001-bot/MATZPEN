import { ZodSchema } from "zod";
import { validateOrThrow } from "./validation";

export const normalizeFieldName = (name: string) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const isDateLike = (value: unknown) => {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return false;
    const digits = String(value).length;
    return digits === 10 || digits === 13;
  }
  if (typeof value !== "string") return false;

  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{2}\/\d{2}\/\d{4}$/,
  ];
  return datePatterns.some((pattern) => pattern.test(value));
}

export const convertToUnixMs = (value: unknown) => {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return value;
    const digits = String(value).length;
    if (digits === 10) return value * 1000;
    if (digits === 13) return value;
    return value;
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return value;
    const date = new Date(value);
    if (!isNaN(date.getTime())) return date.getTime();
  }
  return value;
}

export const normalizeValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (isDateLike(value)) return convertToUnixMs(value);
  if (typeof value === "string") return value.trim();
  return value;
}

export function normalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;

  return Object.entries(obj).reduce((result, [key, value]) => {
    const normalizedKey = normalizeFieldName(key);

    if (value === null || value === undefined) return result;

    if (Array.isArray(value)) {
      return {
        ...result,
        [normalizedKey]: value
          .map((item) => {
            if (typeof item === "object" && item !== null && !Array.isArray(item)) {
              return normalizeObject(item as Record<string, unknown>);
            }
            return normalizeValue(item);
          })
          .filter((item) => item !== null),
      };
    }

    if (typeof value === "object") {
      return { ...result, [normalizedKey]: normalizeObject(value as Record<string, unknown>) };
    }

    const normalizedValue = normalizeValue(value);
    if (normalizedValue !== null) {
      return { ...result, [normalizedKey]: normalizedValue };
    }

    return result;
  }, {} as Record<string, unknown>);
}

export const flattenWithPrefix = (data: Record<string, unknown>, prefix: string) => {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [`${prefix}_${key}`, value])
  );
}

export const metadataPipeline = (data: Record<string, unknown>, prefix: string, schema: ZodSchema | null) => {
  let validated = data;
  if (schema) {
    validated = validateOrThrow(schema, data) as Record<string, unknown>;
  }

  const normalized = normalizeObject(validated);
  return flattenWithPrefix(normalized, prefix);
}
