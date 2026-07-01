import {
  CargoChildSchema, FolderResponseSchema,
  AdapterRequestQuerySchema, AdapterRequestParamsSchema,
  RawDataDocumentSchema, KafkaMessageSchema,
  MetadataApi2Schema,
} from "../index";
import { validateOrThrow } from "../../utils/validation";
import { ValidationError } from "../../errors";
import { extractFileType } from "../../utils/eventBuilder";
import { fromJson } from "../../utils/fieldExtractor";
import { S3Service } from "../../services/connections/s3Client";
import { normalizeFieldName, isDateLike, convertToUnixMs, normalizeObject, flattenWithPrefix } from "../../utils/normalizer";

const s3 = S3Service.getInstance();

const GREEN = "\x1b[32m", RED = "\x1b[31m", RESET = "\x1b[0m", BOLD = "\x1b[1m";
let passed = 0, failed = 0;
const asyncTests: (() => Promise<void>)[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  const wrapped = async () => {
    try { await fn(); passed++; console.log(`  ${GREEN}✓${RESET} ${name}`); }
    catch (error: any) { failed++; console.log(`  ${RED}✗${RESET} ${name}\n    ${RED}${error.message}${RESET}`); }
  };
  asyncTests.push(wrapped);
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

function assertThrows(schema: any, data: unknown, msg?: string) {
  try { validateOrThrow(schema, data); throw new Error(msg || "Expected to throw"); }
  catch (error) { if (!(error instanceof ValidationError)) throw error; }
}

// CargoChildSchema
console.log(`\n${BOLD}CargoChildSchema${RESET}`);
test("valid file with UNIX created", () => { const r = validateOrThrow(CargoChildSchema, { id: "file-abc", name: "photo.png", isFolder: false, created: 1716825600, owner: "john", description: "test" }); assert(r.created === 1716825600, "created"); });
test("valid file minimal", () => { validateOrThrow(CargoChildSchema, { id: "f1", name: "x.png", isFolder: false }); });
test("rejects empty id", () => { assertThrows(CargoChildSchema, { id: "", name: "x", isFolder: false }); });
test("rejects missing isFolder", () => { assertThrows(CargoChildSchema, { id: "f1", name: "x" }); });
test("valid folder", () => { validateOrThrow(CargoChildSchema, { id: "d1", name: "src", isFolder: true, childCount: 5 }); });

// FolderResponseSchema
console.log(`\n${BOLD}FolderResponseSchema${RESET}`);
test("mixed children", () => { const r = validateOrThrow(FolderResponseSchema, { children: [{ id: "f1", name: "a.png", isFolder: false, created: 1716825600 }, { id: "d1", name: "sub", isFolder: true }] }); assert(r.children.length === 2, "2 children"); });
test("rejects missing children", () => { assertThrows(FolderResponseSchema, {}); });

// AdapterRequestQuerySchema
console.log(`\n${BOLD}AdapterRequestQuerySchema${RESET}`);
test("valid query", () => { validateOrThrow(AdapterRequestQuerySchema, { startTime: "1716825600", endTime: "1717430400", recursive: "true" }); });
test("rejects non-numeric", () => { assertThrows(AdapterRequestQuerySchema, { startTime: "abc", endTime: "1717430400", recursive: "true" }); });
test("rejects missing recursive", () => { assertThrows(AdapterRequestQuerySchema, { startTime: "1716825600", endTime: "1717430400" }); });
test("rejects invalid recursive", () => { assertThrows(AdapterRequestQuerySchema, { startTime: "1716825600", endTime: "1717430400", recursive: "maybe" }); });
test("rejects start after end", () => { assertThrows(AdapterRequestQuerySchema, { startTime: "1717430400", endTime: "1716825600", recursive: "true" }); });
test("rejects start equal end", () => { assertThrows(AdapterRequestQuerySchema, { startTime: "1716825600", endTime: "1716825600", recursive: "true" }); });
test("valid without times", () => { validateOrThrow(AdapterRequestQuerySchema, { recursive: "true" }); });
test("valid with only startTime", () => { validateOrThrow(AdapterRequestQuerySchema, { startTime: "123", recursive: "true" }); });
test("valid with only endTime", () => { validateOrThrow(AdapterRequestQuerySchema, { endTime: "456", recursive: "true" }); });

// AdapterRequestParamsSchema
console.log(`\n${BOLD}AdapterRequestParamsSchema${RESET}`);
test("valid", () => { validateOrThrow(AdapterRequestParamsSchema, { folderId: "folder-123" }); });
test("rejects empty", () => { assertThrows(AdapterRequestParamsSchema, { folderId: "" }); });

// RawDataDocumentSchema
console.log(`\n${BOLD}RawDataDocumentSchema${RESET}`);
test("defaults to {}", () => { const r: any = validateOrThrow(RawDataDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", reality: "מציאות אמת מ.ת", image_base64: "abc" }); assert(JSON.stringify(r.metadata) === "{}", "default {}"); });
test("with flat metadata", () => { validateOrThrow(RawDataDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", reality: "מציאות אמת מ.ת", image_base64: "abc", metadata: { ex_category: "financial", ab_retention_days: 365 } }); });
test("empty metadata", () => { const r: any = validateOrThrow(RawDataDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", reality: "מציאות אמת מ.ת", image_base64: "abc", metadata: {} }); assert(JSON.stringify(r.metadata) === "{}", "empty"); });
test("rejects no origin_id", () => { assertThrows(RawDataDocumentSchema, { source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", reality: "מציאות אמת מ.ת", image_base64: "abc" }); });
test("rejects no image_base64", () => { assertThrows(RawDataDocumentSchema, { origin_id: "f1", source_name: "x", insertion_time: "2026-05-27T14:30:00Z", original_file_type: "png", reality: "מציאות אמת מ.ת" }); });

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
test("correct structure with date", () => {
  const key = s3.buildKey("photo.png", new Date("2026-05-27T14:30:00Z"));
  assert(key === "adapter-service/2026/05/27/14/photo.json", key);
});
test("pdf → json", () => assert(s3.buildKey("report.pdf").endsWith("/report.json"), "report.json"));
test("multi-dot", () => assert(s3.buildKey("data.export.final.csv").endsWith("/data.export.final.json"), "dots"));
test("no ext", () => assert(s3.buildKey("README").endsWith("/README.json"), "README.json"));
test("defaults to now", () => { const key = s3.buildKey("test.png"); const parts = key.split("/"); assert(parts[0] === "adapter-service", "source"); assert(parts.length === 6, "6 parts"); });
test("backfill date", () => {
  const key = s3.buildKey("old-file.png", new Date("2025-01-15T09:00:00Z"));
  assert(key === "adapter-service/2025/01/15/09/old-file.json", key);
});

// fromJson
console.log(`\n${BOLD}fromJson${RESET}`);
test("child* unpacks", () => { const r = fromJson({ child: { id: "f1", name: "x" }, folder: { id: "d1" } }, ["child*"]); assert(r.id === "f1", "id"); });
test("no * takes as-is", () => { const r = fromJson({ tags: ["Q3"], status: "active" }, ["tags", "status"]); assert(Array.isArray(r.tags), "tags"); assert(r.status === "active", "status"); });
test("mix * and no *", () => { const r = fromJson({ child: { id: "f1" }, tags: ["Q3"] }, ["child*", "tags"]); assert(r.id === "f1", "unpacked"); assert(Array.isArray(r.tags), "as-is"); });
test("multiple *", () => { const r = fromJson({ child: { id: "f1" }, perms: { read: true } }, ["child*", "perms*"]); assert(r.id === "f1" && r.read === true, "merged"); });
test("skip missing", () => { const r = fromJson({ child: { id: "f1" } }, ["child*", "nope"]); assert(r.id === "f1", "ok"); });
test("empty list", () => { assert(Object.keys(fromJson({ child: { id: "f1" } }, [])).length === 0, "empty"); });
test("* takes everything", () => { const r = fromJson({ a: 1, b: "two", c: [3] }, ["*"]); assert(r.a === 1, "a"); assert(r.b === "two", "b"); assert(Array.isArray(r.c), "c"); });

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

// isDateLike + convertToUnixMs
console.log(`\n${BOLD}isDateLike + convertToUnixMs${RESET}`);
test("ISO is date", () => assert(isDateLike("2026-05-28T14:30:00Z"), "iso"));
test("UNIX sec", () => assert(isDateLike(1716825600), "sec"));
test("UNIX ms", () => assert(isDateLike(1716825600000), "ms"));
test("not date", () => assert(!isDateLike("hello"), "no"));
test("sec → ms", () => assert(convertToUnixMs(1716825600) === 1716825600000, "sec→ms"));
test("ms stays", () => assert(convertToUnixMs(1716825600000) === 1716825600000, "stays"));

// normalizeObject
console.log(`\n${BOLD}normalizeObject${RESET}`);
test("full normalize", () => {
  const r = normalizeObject({ "First Name": "  John  ", "Created At": "2026-05-28T14:30:00Z", "empty": null, "Tags": ["Q3"] });
  assert(r.first_name === "John", "trim"); assert(typeof r.created_at === "number", "date"); assert(Array.isArray(r.tags), "tags");
});
test("nested", () => { const r: any = normalizeObject({ "User Info": { "Full Name": "Jane", "Join Date": "2026-01-01" } }); assert(r.user_info.full_name === "Jane", "nested"); });
test("empty", () => assert(Object.keys(normalizeObject({})).length === 0, "empty"));

// MetadataApi2Schema
console.log(`\n${BOLD}MetadataApi2Schema (contentData.Position WKT string)${RESET}`);
test("valid single POINT", () => { validateOrThrow(MetadataApi2Schema, { contentData: { Position: "POINT (34.7818 32.0853)" } }); });
test("valid POLYGON", () => { validateOrThrow(MetadataApi2Schema, { contentData: { Position: "POLYGON ((35 33, 36 33, 36 34, 35 33))" } }); });
test("valid MULTIPOINT", () => { validateOrThrow(MetadataApi2Schema, { contentData: { Position: "MULTIPOINT (35 33, 36 34)" } }); });
test("valid with extra fields (catchall)", () => { validateOrThrow(MetadataApi2Schema, { contentData: { Position: "POINT (35 33)", other: "x" }, isDeleted: false }); });
test("rejects missing contentData", () => { assertThrows(MetadataApi2Schema, { other: "data" }); });
test("rejects missing Position", () => { assertThrows(MetadataApi2Schema, { contentData: { other: "x" } }); });
test("rejects invalid WKT Position", () => { assertThrows(MetadataApi2Schema, { contentData: { Position: "34.78, 32.08" } }); });
test("rejects non-string Position", () => { assertThrows(MetadataApi2Schema, { contentData: { Position: 123 } }); });

// geometryToWkt
import { geometryToWkt, geometriesToWkt } from "../../utils/geometry";
console.log(`\n${BOLD}geometryToWkt${RESET}`);
test("Point → WKT", () => { assert(geometryToWkt({ type: "Point", coordinates: [35, 33] }) === "POINT(35 33)", "point"); });
test("Polygon → WKT", () => { assert(geometryToWkt({ type: "Polygon", coordinates: [[[35,33],[36,33],[36,34],[35,33]]] }) === "POLYGON((35 33, 36 33, 36 34, 35 33))", "polygon"); });
test("LineString → WKT", () => { assert(geometryToWkt({ type: "LineString", coordinates: [[35,33],[36,34]] }) === "LINESTRING(35 33, 36 34)", "linestring"); });
test("unknown type → null", () => { assert(geometryToWkt({ type: "Unknown", coordinates: [] }) === null, "null"); });
test("array of geometries", () => {
  const result = geometriesToWkt([
    { type: "Point", coordinates: [35, 33] },
    { type: "Point", coordinates: [36, 34] },
  ]);
  assert(result.length === 2, "two results");
  assert(result[0] === "POINT(35 33)", "first");
});
test("skips invalid in array", () => {
  const result = geometriesToWkt([
    { type: "Point", coordinates: [35, 33] },
    { type: "Unknown", coordinates: [] },
  ]);
  assert(result.length === 1, "one valid");
});

// ============================================
// CargoChildSchema — coerce
// ============================================
console.log(`\n${BOLD}CargoChildSchema coerce${RESET}`);
test("id number → string", () => {
  const result = validateOrThrow(CargoChildSchema, { id: 12345, name: "photo.png", isFolder: false });
  assert(result.id === "12345", `expected "12345", got "${result.id}"`);
  assert(typeof result.id === "string", "id should be string");
});
test("created string → number", () => {
  const result = validateOrThrow(CargoChildSchema, { id: "f1", name: "photo.png", isFolder: false, created: "1716825600" });
  assert(result.created === 1716825600, `expected 1716825600, got ${result.created}`);
  assert(typeof result.created === "number", "created should be number");
});
test("id empty string fails min(1)", () => {
  assertThrows(CargoChildSchema, { id: "", name: "photo.png", isFolder: false });
});

// ============================================
// metadataPipeline
// ============================================
import { metadataPipeline } from "../../utils/normalizer";
console.log(`\n${BOLD}metadataPipeline${RESET}`);
test("validate + normalize + flatten", () => {
  const result = metadataPipeline(
    { id: "f1", name: "photo.png", isFolder: false },
    "ex",
    CargoChildSchema
  );
  assert(result.ex_id === "f1", "ex_id");
  assert(result.ex_name === "photo.png", "ex_name");
  assert(result.ex_isfolder === false, "ex_isfolder");
});
test("without schema (null)", () => {
  const result = metadataPipeline({ hello: "World", count: 5 }, "ab", null);
  assert(result.ab_hello === "World", "ab_hello");
  assert(result.ab_count === 5, "ab_count");
});
test("normalizes keys", () => {
  const result = metadataPipeline({ "Full Name": "John", "Created At": "test" }, "ex", null);
  assert("ex_full_name" in result, "full_name normalized");
  assert("ex_created_at" in result, "created_at normalized");
});
test("normalizes date values", () => {
  const result = metadataPipeline({ created: 1716825600 }, "ex", null);
  assert(result.ex_created === 1716825600000, `expected ms, got ${result.ex_created}`);
});

// ============================================
// CargoChatMetadata — process logic
// ============================================
import { CargoChatMetadata } from "../../services/cargoChatMetadata";
console.log(`\n${BOLD}CargoChatMetadata${RESET}`);

function setupChatMetadata(): CargoChatMetadata {
  const chat = new CargoChatMetadata({});
  const instance = chat as any;

  instance.allRows = [
    { date: "2026-06-01", time: "14:28:00", user: "john", displayName: "ג'ון", content: "הנה התמונה", filename: "photo1.png", excelName: "chat_2026_06_01" },
    { date: "2026-06-01", time: "14:29:00", user: "john", displayName: "ג'ון", content: "שלחתי", filename: "", excelName: "chat_2026_06_01" },
    { date: "2026-06-01", time: "14:30:00", user: "john", displayName: "ג'ון", content: "ראית?", filename: "", excelName: "chat_2026_06_01" },
    { date: "2026-06-01", time: "14:31:00", user: "john", displayName: "ג'ון", content: "עדכן אותי", filename: "", excelName: "chat_2026_06_01" },
    { date: "2026-06-01", time: "14:45:00", user: "jane", displayName: "ג'יין", content: "תודה", filename: "", excelName: "chat_2026_06_01" },
    { date: "2026-06-01", time: "14:28:30", user: "jane", displayName: "ג'יין", content: "מעניין", filename: "", excelName: "chat_2026_06_01" },
    { date: "2026-06-01", time: "15:00:00", user: "john", displayName: "ג'ון", content: "הודעה מאוחרת", filename: "", excelName: "chat_2026_06_01" },
  ];

  instance.fileMap = new Map([
    ["photo1", { user: "john", datetime: new Date("2026-06-01T14:28:00"), excelName: "chat_2026_06_01" }],
  ]);

  return chat;
}

test("finds messages for matching file", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-001", "req-1", { name: "photo1.png" });
  assert(result.em_user === "john", `user: ${result.em_user}`);
  assert(result.em_message_count === 3, `count: ${result.em_message_count}, expected 3`);
});

test("only same user messages", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-001", "req-1", { name: "photo1.png" });
  const messages = result.em_messages as any[];
  const users = messages.map((msg: any) => msg.content);
  assert(!users.includes("תודה"), "jane's message should not be included");
  assert(!users.includes("מעניין"), "jane's message should not be included");
});

test("respects ±2 minute window", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-001", "req-1", { name: "photo1.png" });
  const messages = result.em_messages as any[];
  const contents = messages.map((msg: any) => msg.content);
  // 14:28 ±2min = 14:26-14:30
  assert(contents.includes("הנה התמונה"), "14:28 should be in window");
  assert(contents.includes("שלחתי"), "14:29 should be in window");
  assert(contents.includes("ראית?"), "14:30 should be in window");
  assert(!contents.includes("הודעה מאוחרת"), "15:00 should be outside window");
});

test("edge of window — 2 min exactly", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-001", "req-1", { name: "photo1.png" });
  const messages = result.em_messages as any[];
  const contents = messages.map((msg: any) => msg.content);
  // 14:28 + 2min = 14:30 — should be included (<=)
  assert(contents.includes("ראית?"), "exactly 2 min should be included");
  // 14:28 + 3min = 14:31 — should NOT be included
  assert(!contents.includes("עדכן אותי"), "3 min should be outside window");
});

test("file not in Excel returns empty", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-002", "req-1", { name: "unknown.png" });
  assert(Object.keys(result).length === 0, "should be empty");
});

test("no fileInfo returns empty", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-003", "req-1");
  assert(Object.keys(result).length === 0, "should be empty");
});

test("empty filename returns empty", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-004", "req-1", { name: "" });
  assert(Object.keys(result).length === 0, "should be empty");
});

test("metadata has correct prefix em_", async () => {
  const chat = setupChatMetadata();
  const result = await chat.process("file-001", "req-1", { name: "photo1.png" });
  assert("em_user" in result, "em_user prefix");
  assert("em_file_date" in result, "em_file_date prefix");
  assert("em_messages" in result, "em_messages prefix");
  assert("em_message_count" in result, "em_message_count prefix");
});

// ============================================
// TIME_WINDOW_MINUTES constant
// ============================================
import { TIME_WINDOW_MINUTES, EXCEL_COLUMNS, CARGO_CHAT_PREFIX } from "../../utils/constants";
console.log(`\n${BOLD}Chat constants${RESET}`);
test("TIME_WINDOW_MINUTES is 2", () => assert(TIME_WINDOW_MINUTES === 2, `got ${TIME_WINDOW_MINUTES}`));
test("CARGO_CHAT_PREFIX is em", () => assert(CARGO_CHAT_PREFIX === "em", `got ${CARGO_CHAT_PREFIX}`));
test("EXCEL_COLUMNS has all fields", () => {
  assert(EXCEL_COLUMNS.DATE === "תאריך", "DATE");
  assert(EXCEL_COLUMNS.TIME === "שעה", "TIME");
  assert(EXCEL_COLUMNS.USER === "שם משתמש", "USER");
  assert(EXCEL_COLUMNS.DISPLAY_NAME === "שם תצוגה", "DISPLAY_NAME");
  assert(EXCEL_COLUMNS.CONTENT === "תוכן", "CONTENT");
  assert(EXCEL_COLUMNS.FILENAME === "שם קובץ", "FILENAME");
});

// Run all tests (sync + async)
(async () => {
  for (const testFn of asyncTests) {
    await testFn();
  }

  console.log(`\n${BOLD}─────────────────────────────${RESET}`);
  console.log(`${BOLD}Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`);
  console.log(`${BOLD}─────────────────────────────${RESET}\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
