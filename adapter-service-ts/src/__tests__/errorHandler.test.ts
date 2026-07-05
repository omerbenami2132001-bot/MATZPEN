import "./setupEnv";
import { describe, test, assert, assertEqual } from "./harness";
import { ErrorHandler } from "../utils/errorHandler";
import { ValidationError } from "../errors";

describe("ErrorHandler.classify", () => {
  test("classifies ValidationError", () => {
    const c = ErrorHandler.classify(new ValidationError(["bad field"]));
    assertEqual(c.errorType, "VALIDATION_ERROR", "errorType");
    assertEqual(c.httpStatus, null, "no httpStatus");
  });

  test("classifies HTTP error from axios-like response", () => {
    const err = Object.assign(new Error("request failed"), { response: { status: 429 } });
    const c = ErrorHandler.classify(err);
    assertEqual(c.httpStatus, 429, "status 429");
    assert(c.errorType.startsWith("HTTP_429"), `errorType was ${c.errorType}`);
    assert(c.statusText !== null, "statusText resolved");
  });

  test("classifies HTTP 500", () => {
    const err = Object.assign(new Error("server"), { response: { status: 500 } });
    const c = ErrorHandler.classify(err);
    assertEqual(c.httpStatus, 500, "status 500");
    assert(c.errorType.includes("500"), "errorType includes 500");
  });

  test("classifies unknown error", () => {
    const c = ErrorHandler.classify(new Error("who knows"));
    assertEqual(c.errorType, "UNKNOWN_ERROR", "errorType");
    assertEqual(c.httpStatus, null, "no status");
    assertEqual(c.message, "who knows", "message preserved");
  });
});

describe("ErrorHandler.buildFileResult", () => {
  test("builds a failed FileResult with classification", () => {
    const err = Object.assign(new Error("nope"), { response: { status: 403 } });
    const r = ErrorHandler.buildFileResult("file-9", err, "fetch_metadata", 42);
    assertEqual(r.success, false, "success false");
    assertEqual(r.fileId, "file-9", "fileId");
    assertEqual(r.failedStep, "fetch_metadata", "failedStep");
    assertEqual(r.durationMs, 42, "durationMs");
    assertEqual(r.httpStatus, 403, "httpStatus");
  });

  test("includes validationErrors for ValidationError", () => {
    const r = ErrorHandler.buildFileResult("file-1", new ValidationError(["e1", "e2"]), "validate", 5);
    assert(Array.isArray(r.validationErrors), "validationErrors array");
    assertEqual(r.validationErrors!.length, 2, "2 errors");
  });
});

describe("ErrorHandler.buildErrorData", () => {
  test("merges context and classification", () => {
    const err = Object.assign(new Error("boom"), { response: { status: 502, data: { detail: "bad gateway" } } });
    const d = ErrorHandler.buildErrorData(err, "download", { fileId: "f1" });
    assertEqual(d.failedStep, "download", "failedStep");
    assertEqual(d.fileId, "f1", "context merged");
    assertEqual(d.httpStatus, 502, "httpStatus");
    assert("httpData" in d, "httpData included when response.data present");
  });
});
