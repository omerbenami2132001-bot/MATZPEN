import { ZodSchema } from "zod";
import { validateOrThrow } from "./validation";

/**
 * Normalizes field names to snake_case.
 * "First Name" → "first_name"
 * "Created At" → "created_at"
 * "100% Complete!" → "100_complete"
 * "file--name" → "file_name"
 * "isFolder" → "isfolder"
 */
export const normalizeFieldName = (name: string) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Checks if a value looks like a date/timestamp.
 * 1716825600 (10 digits, integer) → true (UNIX seconds)
 * 1716825600000 (13 digits, integer) → true (UNIX ms)
 * "2026-05-28T14:30:00Z" → true (ISO)
 * "2026-05-28" → true (date only)
 * 1.23123134 → false (float, not a timestamp)
 * "hello" → false
 */
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

/**
 * Converts a date-like value to UNIX milliseconds.
 * 1716825600 → 1716825600000 (sec → ms)
 * 1716825600000 → 1716825600000 (already ms)
 * "2026-05-28T14:30:00Z" → 1780063800000
 */
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

/**
 * Adds a prefix to every key in an object.
 * flattenWithPrefix({ id: "1", name: "test" }, "ex")
 * → { ex_id: "1", ex_name: "test" }
 */
export const flattenWithPrefix = (data: Record<string, unknown>, prefix: string) => {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [`${prefix}_${key}`, value])
  );
}

/**
 * Shared metadata pipeline: validate → normalize → flatten.
 * metadataPipeline({ Position: "POINT(...)" }, "ab", MetadataApi2Schema)
 * → { ab_position: "POINT(...)" }
 */
export const metadataPipeline = (data: Record<string, unknown>, prefix: string, schema: ZodSchema | null) => {
  let validated = data;
  if (schema) {
    validated = validateOrThrow(schema, data) as Record<string, unknown>;
  }

  const normalized = normalizeObject(validated);
  return flattenWithPrefix(normalized, prefix);
}
