
const getNestedField = (obj: any, path: string) =>
  path.split(".").reduce((current, key) => current?.[key], obj);

export const fromJson = (responseData: Record<string, unknown>, fields: string[]) => {
  return fields.reduce((extracted, fieldSpec) => {
    if (fieldSpec === "*") {
      return { ...extracted, ...responseData };
    }

    const shouldUnpack = fieldSpec.endsWith("*");
    const cleanSpec = shouldUnpack ? fieldSpec.slice(0, -1) : fieldSpec;

    const value = cleanSpec.includes(".")
      ? getNestedField(responseData, cleanSpec)
      : responseData[cleanSpec];

    if (value === undefined || value === null) return extracted;

    if (shouldUnpack && typeof value === "object" && !Array.isArray(value)) {
      return { ...extracted, ...(value as Record<string, unknown>) };
    }

    const key = cleanSpec.split(".").pop()!;
    return { ...extracted, [key]: value };
  }, {} as Record<string, unknown>);
};

