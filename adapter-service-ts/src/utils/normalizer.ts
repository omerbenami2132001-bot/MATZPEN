export function normalizeFieldName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function isDateLike(value: unknown): boolean {
  if (typeof value === "number") {
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

export function toUnixMs(value: unknown): unknown {
  if (typeof value === "number") {
    const digits = String(value).length;
    if (digits === 10) return value * 1000;
    if (digits === 13) return value;
    return value;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!isNaN(date.getTime())) return date.getTime();
  }
  return value;
}

export function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (isDateLike(value)) return toUnixMs(value);
  if (typeof value === "string") return value.trim();
  return value;
}

export function normalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = normalizeFieldName(key);

    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      result[normalizedKey] = value
        .map((item) => {
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            return normalizeObject(item as Record<string, unknown>);
          }
          return normalizeValue(item);
        })
        .filter((item) => item !== undefined);
      continue;
    }

    if (typeof value === "object") {
      result[normalizedKey] = normalizeObject(value as Record<string, unknown>);
      continue;
    }

    const normalizedValue = normalizeValue(value);
    if (normalizedValue !== undefined) {
      result[normalizedKey] = normalizedValue;
    }
  }

  return result;
}
