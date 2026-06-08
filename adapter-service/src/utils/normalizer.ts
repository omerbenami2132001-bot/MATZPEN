//CR I know comments are not usually used but here I would use a description for the function
// to explain what it does with examples
export function normalizeFieldName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
//CR this point is global for all functions and arrow functions in typescript
// if you don't specifically want to force a return type you should not write :Type
// since it does it automatically
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

//CR all functions names should start with verb. for example convertToUnixMS
//TODO CR check use of function
export function toUnixMs(value: unknown): unknown {
  //CR dangerous, what if the number is 1.23123134? then the dot counts as a digit and it is not actually a date
  if (typeof value === "number") {
    const digits = String(value).length;
    if (digits === 10) return value * 1000;
    if (digits === 13) return value;
    return value;
  }
  //CR very dangerous line, if we have a string of a number? for example '123'. this will return a valid date
  if (typeof value === "string") {
    const date = new Date(value);
    if (!isNaN(date.getTime())) return date.getTime();
  }
  return value;
}

export function normalizeValue(value: unknown): unknown {
  //CR you don't need to return undefined. if you write return without a value it returns undefined
  // it is not best practice to return undefined with other value. should always return a value or null
  // or always empty return
  if (value === null || value === undefined) return undefined;
  if (isDateLike(value)) return toUnixMs(value);
  if (typeof value === "string") return value.trim();
  return value;
}


export function normalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;

  const result: Record<string, unknown> = {};
  //CR this is a correct use of for instead of iterating functions like forEach
  // because the forEach handles the return and function calls kinda weird
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
