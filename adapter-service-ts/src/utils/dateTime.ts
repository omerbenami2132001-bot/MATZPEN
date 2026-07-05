/**
 * Converts a naive date + time (as written, with no timezone conversion) to
 * UNIX epoch milliseconds. The wall-clock value is preserved exactly: "09:30"
 * yields a timestamp that reads as 09:30 in UTC — the hour is NOT shifted.
 *
 * This is intentional: the source times are already the values we want stored,
 * so no timezone math is applied. The result is fully deterministic and
 * independent of the server's own timezone and of DST.
 *
 * @param dateStr e.g. "2024-05-27"
 * @param timeStr e.g. "09:30:00" or "09:30"
 * @returns UNIX ms, or NaN if the inputs are unparseable.
 */
export const wallTimeToUnixMs = (dateStr: string, timeStr: string): number => {
  const dateParts = dateStr.split("-").map(Number);
  const timeParts = timeStr.split(":").map(Number);

  if (dateParts.length < 3 || dateParts.some(Number.isNaN)) return NaN;
  if (timeParts.length < 2 || timeParts.slice(0, 2).some(Number.isNaN)) return NaN;

  const [year, month, day] = dateParts;
  const [hour, minute, second = 0] = timeParts;

  return Date.UTC(year, month - 1, day, hour, minute, second);
};
