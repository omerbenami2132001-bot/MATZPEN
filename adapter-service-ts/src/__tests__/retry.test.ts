import "./setupEnv";
import { describe, test, assert, assertEqual, assertRejects } from "./harness";
import { withRetry } from "../utils/retry";

describe("withRetry", () => {
  test("returns result on first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return "ok"; }, { retries: 3, delayMs: 0 });
    assertEqual(result, "ok", "result");
    assertEqual(calls, 1, "called once");
  });

  test("succeeds after transient failures", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "recovered";
    }, { retries: 5, delayMs: 0 });
    assertEqual(result, "recovered", "result");
    assertEqual(calls, 3, "called 3 times");
  });

  test("throws last error after exhausting retries", async () => {
    let calls = 0;
    await assertRejects(async () => {
      await withRetry(async () => { calls++; throw new Error(`fail-${calls}`); }, { retries: 3, delayMs: 0 });
    }, "should reject after retries");
    assertEqual(calls, 3, "attempted exactly retries times");
  });

  test("preserves the thrown error", async () => {
    let caught: Error | null = null;
    try {
      await withRetry(async () => { throw new Error("specific-message"); }, { retries: 2, delayMs: 0 });
    } catch (e) {
      caught = e as Error;
    }
    assert(caught !== null, "error caught");
    assertEqual(caught!.message, "specific-message", "message preserved");
  });

  test("respects retries=1 (single attempt, no retry)", async () => {
    let calls = 0;
    await assertRejects(async () => {
      await withRetry(async () => { calls++; throw new Error("x"); }, { retries: 1, delayMs: 0 });
    });
    assertEqual(calls, 1, "only one attempt");
  });
});
