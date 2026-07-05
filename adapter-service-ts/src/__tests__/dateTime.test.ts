import "./setupEnv";
import { describe, test, assert, assertEqual } from "./harness";
import { wallTimeToUnixMs } from "../utils/dateTime";

describe("wallTimeToUnixMs - wall clock preserved as-is (no shift)", () => {
  test("09:30 stays 09:30 in the timestamp (no UTC conversion)", () => {
    const ms = wallTimeToUnixMs("2024-05-27", "09:30:00");
    assertEqual(new Date(ms).toISOString(), "2024-05-27T09:30:00.000Z", "hour preserved");
  });

  test("hour is not affected by season (no DST math)", () => {
    const summer = wallTimeToUnixMs("2024-06-01", "12:00:00");
    const winter = wallTimeToUnixMs("2024-01-01", "12:00:00");
    assertEqual(new Date(summer).toISOString(), "2024-06-01T12:00:00.000Z", "summer noon = 12:00");
    assertEqual(new Date(winter).toISOString(), "2024-01-01T12:00:00.000Z", "winter noon = 12:00");
  });

  test("returns numeric UNIX ms (13 digits)", () => {
    const ms = wallTimeToUnixMs("2024-05-27", "09:30:00");
    assert(typeof ms === "number", "is number");
    assertEqual(String(ms).length, 13, "13-digit ms");
  });

  test("midnight stays 00:00", () => {
    const ms = wallTimeToUnixMs("2024-07-01", "00:00:00");
    assertEqual(new Date(ms).toISOString(), "2024-07-01T00:00:00.000Z", "midnight preserved");
  });

  test("end of day stays 23:59", () => {
    const ms = wallTimeToUnixMs("2024-12-31", "23:59:00");
    assertEqual(new Date(ms).toISOString(), "2024-12-31T23:59:00.000Z", "23:59 preserved");
  });

  test("accepts time without seconds", () => {
    const ms = wallTimeToUnixMs("2024-05-27", "09:30");
    assertEqual(new Date(ms).toISOString(), "2024-05-27T09:30:00.000Z", "no-seconds handled");
  });

  test("is deterministic regardless of server timezone", () => {
    // Date.UTC ignores the host timezone entirely, so this is stable by construction.
    const ms = wallTimeToUnixMs("2024-05-27", "14:00:00");
    assertEqual(ms, Date.UTC(2024, 4, 27, 14, 0, 0), "matches Date.UTC directly");
  });

  test("returns NaN for malformed date", () => {
    assert(Number.isNaN(wallTimeToUnixMs("not-a-date", "09:30:00")), "malformed date → NaN");
  });

  test("returns NaN for malformed time", () => {
    assert(Number.isNaN(wallTimeToUnixMs("2024-05-27", "banana")), "malformed time → NaN");
  });
});
