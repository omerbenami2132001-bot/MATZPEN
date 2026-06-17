// FieldExtractor — חילוץ שדות ממקורות שונים.
// כל מקור metadata משתמש בפונקציה המתאימה לפורמט שלו.

/**
 * Extracts fields from a JSON API response.
 * fields: ["*"] → take everything
 * fields: ["data*"] → unpack "data" dict to top level
 * fields: ["tags"] → take "tags" as-is
 *
 * fromJson({ data: { a: 1, b: 2 }, audit: { x: 1 } }, ["data*"])
 * → { a: 1, b: 2 }
 */
export const fromJson = (responseData: Record<string, unknown>, fields: string[]) => {
  return fields.reduce((extractedFields, fieldSpec) => {
    if (fieldSpec === "*") {
      return { ...extractedFields, ...responseData };
    }

    const shouldUnpack = fieldSpec.endsWith("*");
    const field = shouldUnpack ? fieldSpec.slice(0, -1) : fieldSpec;

    const value = responseData[field];
    if (value === undefined || value === null) return extractedFields;

    if (shouldUnpack && typeof value === "object" && !Array.isArray(value)) {
      return { ...extractedFields, ...(value as Record<string, unknown>) };
    }

    return { ...extractedFields, [field]: value };
  }, {} as Record<string, unknown>);
}

// TODO: fromExcel(worksheet, fields) — חילוץ שדות מ-Excel
// TODO: fromCsv(rows, fields) — חילוץ שדות מ-CSV
