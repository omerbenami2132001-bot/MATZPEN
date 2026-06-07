import {
  ChildSchema, FolderResponseSchema,
  AdapterRequestHeadersSchema, AdapterRequestParamsSchema,
  S3FileDocumentSchema, KafkaMessageSchema,
  MetadataApi2Schema,
} from "../index";
import { validateOrThrow, ValidationError } from "../../utils/validation";
import { extractFileType } from "../../utils/eventBuilder";
import { MetadataClient } from "../../utils/metadataClient";
import { S3Service } from "../../utils/s3Client";
import { normalizeFieldName, isDateLike, toUnixMs, normalizeObject } from "../../utils/normalizer";

const flattenWithPrefix = MetadataClient.flattenWithPrefix;
const extractFields = MetadataClient.extractFields;
const s3 = new S3Service();

const GREEN = "\x1b[32m", RED = "\x1b[31m", RESET = "\x1b[0m", BOLD = "\x1b[1m";
let passed = 0, failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ${GREEN}✓${RESET} ${name}`); }
  catch (error: any) { failed++; console.log(`  ${RED}✗${RESET} ${name}\n    ${RED}${error.message}${RESET}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

function assertThrows(schema: any, data: unknown, msg?: string) {
  try { validateOrThrow(schema, data); throw new Error(msg || "Expected to throw"); }
  catch (error) { if (!(error instanceof ValidationError)) throw error; }
}

// ChildSchema
console.log(`\n${BOLD}ChildSchema${RESET}`);
test("valid file with UNIX created", () => { const r = validateOrThrow(ChildSchema, { id: "file-abc", name: "photo.png", isFolder: false, created: 1716825600, owner: "john", description: "test" }); assert(r.created === 1716825600, "created"); });
test("valid file minimal", () => { validateOrThrow(ChildSchema, { id: "f1", name: "x.png", isFolder: false }); });
test("rejects empty id", () => { assertThrows(ChildSchema, { id: "", name: "x", isFolder: false }); });
test("rejects missing isFolder", () => { assertThrows(ChildSchema, { id: "f1", name: "x" }); });
test("valid folder", () => { validateOrThrow(ChildSchema, { id: "d1", name: "src", isFolder: true, childCount: 5 }); });

// FolderResponseSchema
console.log(`\n${BOLD}FolderResponseSchema${RESET}`);
test("mixed children", () => { const r = validateOrThrow(FolderResponseSchema, { children: [{ id: "f1", name: "a.png", isFolder: false, created: 1716825600 }, { id: "d1", name: "sub", isFolder: true }] }); assert(r.children.length === 2, "2 children"); });
test("rejects missing children", () => { assertThrows(FolderResponseSchema, {}); });

// AdapterRequestHeadersSchema
console.log(`\n${BOLD}AdapterRequestHeadersSchema${RESET}`);
test("valid headers", () => { validateOrThrow(AdapterRequestHeadersSchema, { "x-start-time": "1716825600", "x-end-time": "1717430400", "x-recursive": "true" }); });
test("rejects non-numeric", () => { assertThrows(AdapterRequestHeadersSchema, { "x-start-time": "abc", "x-end-time": "1717430400", "x-recursive": "true" }); });
test("rejects missing recursive", () => { assertThrows(AdapterRequestHeadersSchema, { "x-start-time": "1716825600", "x-end-time": "1717430400" }); });
test("rejects invalid recursive", () => { assertThrows(AdapterRequestHeadersSchema, { "x-start-time": "1716825600", "x-end-time": "1717430400", "x-recursive": "maybe" }); });
test("rejects start after end", () => { assertThrows(AdapterRequestHeadersSchema, { "x-start-time": "1717430400", "x-end-time": "1716825600", "x-recursive": "true" }); });
test("rejects start equal end", () => { assertThrows(AdapterRequestHeadersSchema, { "x-start-time": "1716825600", "x-end-time": "1716825600", "x-recursive": "true" }); });

// AdapterRequestParamsSchema
console.log(`\n${BOLD}AdapterRequestParamsSchema${RESET}`);
test("valid", () => { validateOrThrow(AdapterRequestParamsSchema, { folderId: "folder-123" }); });
test("rejects empty", () => { assertThrows(AdapterRequestParamsSchema, { folderId: "" }); });

// S3FileDocumentSchema
console.log(`\n${BOLD}S3FileDocumentSchema${RESET}`);
test("defaults to {}", () => { const r: any = validateOrThrow(S3FileDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", image_base64: "abc" }); assert(JSON.stringify(r.metadata) === "{}", "default {}"); });
test("with flat metadata", () => { validateOrThrow(S3FileDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", image_base64: "abc", metadata: { ex_category: "financial", ab_retention_days: 365 } }); });
test("empty metadata", () => { const r: any = validateOrThrow(S3FileDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", image_base64: "abc", metadata: {} }); assert(JSON.stringify(r.metadata) === "{}", "empty"); });
test("rejects no origin_id", () => { assertThrows(S3FileDocumentSchema, { source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", image_base64: "abc" }); });
test("rejects no image_base64", () => { assertThrows(S3FileDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png" }); });

// KafkaMessageSchema
console.log(`\n${BOLD}KafkaMessageSchema${RESET}`);
test("valid", () => { validateOrThrow(KafkaMessageSchema, { source: "adapter-service", path: "a/b/c.json", bucket: "raw-data", message: "test", request_id: "660e8400-e29b-41d4-a716-446655440000" }); });
test("rejects invalid source", () => { assertThrows(KafkaMessageSchema, { source: "unknown", path: "a/b.json", bucket: "x", message: "t", request_id: "660e8400-e29b-41d4-a716-446655440000" }); });
test("rejects no path", () => { assertThrows(KafkaMessageSchema, { source: "adapter-service", bucket: "x", message: "t", request_id: "660e8400-e29b-41d4-a716-446655440000" }); });
test("rejects bad uuid", () => { assertThrows(KafkaMessageSchema, { source: "adapter-service", path: "a/b.json", bucket: "x", message: "t", request_id: "not-uuid" }); });

// extractFileType
console.log(`\n${BOLD}extractFileType${RESET}`);
test("png", () => assert(extractFileType("photo.png") === "png", "png"));
test("pdf multi-dot", () => assert(extractFileType("report.final.pdf") === "pdf", "pdf"));
test("no ext", () => assert(extractFileType("README") === "unknown", "unknown"));
test("lowercase", () => assert(extractFileType("Image.PNG") === "png", "lower"));

// S3Service.buildKey
console.log(`\n${BOLD}S3Service.buildKey${RESET}`);
test("correct structure", () => { const k = s3.buildKey("photo.png"); const p = k.split("/"); assert(p[0] === "adapter-service", "source"); assert(p[5] === "photo.json", "name.json"); });
test("pdf → json", () => assert(s3.buildKey("report.pdf").endsWith("/report.json"), "report.json"));
test("multi-dot", () => assert(s3.buildKey("data.export.final.csv").endsWith("/data.export.final.json"), "dots"));
test("no ext", () => assert(s3.buildKey("README").endsWith("/README.json"), "README.json"));

// extractFields
console.log(`\n${BOLD}extractFields${RESET}`);
test("child* unpacks", () => { const r = extractFields({ child: { id: "f1", name: "x" }, folder: { id: "d1" } }, ["child*"]); assert(r.id === "f1", "id"); });
test("no * takes as-is", () => { const r = extractFields({ tags: ["Q3"], status: "active" }, ["tags", "status"]); assert(Array.isArray(r.tags), "tags"); assert(r.status === "active", "status"); });
test("mix * and no *", () => { const r = extractFields({ child: { id: "f1" }, tags: ["Q3"] }, ["child*", "tags"]); assert(r.id === "f1", "unpacked"); assert(Array.isArray(r.tags), "as-is"); });
test("multiple *", () => { const r = extractFields({ child: { id: "f1" }, perms: { read: true } }, ["child*", "perms*"]); assert(r.id === "f1" && r.read === true, "merged"); });
test("skip missing", () => { const r = extractFields({ child: { id: "f1" } }, ["child*", "nope"]); assert(r.id === "f1", "ok"); });
test("empty list", () => { assert(Object.keys(extractFields({ child: { id: "f1" } }, [])).length === 0, "empty"); });
test("* takes everything", () => { const r = extractFields({ a: 1, b: "two", c: [3] }, ["*"]); assert(r.a === 1, "a"); assert(r.b === "two", "b"); assert(Array.isArray(r.c), "c"); });

// flattenWithPrefix
console.log(`\n${BOLD}flattenWithPrefix${RESET}`);
test("adds prefix", () => { const r = flattenWithPrefix({ category: "fin", dept: "acc" }, "ex"); assert(r.ex_category === "fin", "ex_category"); });
test("empty", () => { assert(Object.keys(flattenWithPrefix({}, "ex")).length === 0, "empty"); });

// normalizeFieldName
console.log(`\n${BOLD}normalizeFieldName${RESET}`);
test("spaces → _", () => assert(normalizeFieldName("First Name") === "first_name", "first_name"));
test("lowercase", () => assert(normalizeFieldName("Created At") === "created_at", "created_at"));
test("special chars", () => assert(normalizeFieldName("100% Complete!") === "100_complete", "100_complete"));
test("dashes → _", () => assert(normalizeFieldName("file--name") === "file_name", "file_name"));

// isDateLike + toUnixMs
console.log(`\n${BOLD}isDateLike + toUnixMs${RESET}`);
test("ISO is date", () => assert(isDateLike("2026-05-28T14:30:00Z"), "iso"));
test("UNIX sec", () => assert(isDateLike(1716825600), "sec"));
test("UNIX ms", () => assert(isDateLike(1716825600000), "ms"));
test("not date", () => assert(!isDateLike("hello"), "no"));
test("sec → ms", () => assert(toUnixMs(1716825600) === 1716825600000, "sec→ms"));
test("ms stays", () => assert(toUnixMs(1716825600000) === 1716825600000, "stays"));

// normalizeObject
console.log(`\n${BOLD}normalizeObject${RESET}`);
test("full normalize", () => {
  const r = normalizeObject({ "First Name": "  John  ", "Created At": "2026-05-28T14:30:00Z", "empty": null, "Tags": ["Q3"] });
  assert(r.first_name === "John", "trim"); assert(typeof r.created_at === "number", "date"); assert(Array.isArray(r.tags), "tags");
});
test("nested", () => { const r: any = normalizeObject({ "User Info": { "Full Name": "Jane", "Join Date": "2026-01-01" } }); assert(r.user_info.full_name === "Jane", "nested"); });
test("empty", () => assert(Object.keys(normalizeObject({})).length === 0, "empty"));

// MetadataApi2Schema
console.log(`\n${BOLD}MetadataApi2Schema (Position WKT)${RESET}`);
test("valid WKT POINT (capital P)", () => { validateOrThrow(MetadataApi2Schema, { Position: "POINT(34.7818 32.0853)", Sensitivity: "internal" }); });
test("valid WKT POINT (lowercase p)", () => { validateOrThrow(MetadataApi2Schema, { position: "POINT(34.7818 32.0853)", sensitivity: "internal" }); });
test("valid negative coords", () => { validateOrThrow(MetadataApi2Schema, { Position: "POINT(-73.9857 40.7484)", Other: "data" }); });
test("valid integers", () => { validateOrThrow(MetadataApi2Schema, { Position: "POINT(35 32)" }); });
test("rejects missing Position", () => { assertThrows(MetadataApi2Schema, { Sensitivity: "internal" }); });
test("rejects non-WKT format", () => { assertThrows(MetadataApi2Schema, { Position: "34.7818, 32.0853" }); });
test("rejects number Position", () => { assertThrows(MetadataApi2Schema, { Position: 123 }); });
test("rejects empty string", () => { assertThrows(MetadataApi2Schema, { Position: "" }); });

// Results
console.log(`\n${BOLD}─────────────────────────────${RESET}`);
console.log(`${BOLD}Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`);
console.log(`${BOLD}─────────────────────────────${RESET}\n`);
process.exit(failed > 0 ? 1 : 0);
