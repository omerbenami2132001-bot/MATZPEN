import proj4 from "proj4";

const LATLONFORMAT = "EPSG:4326";

// UTM zone 36N (WGS84) — the grid Israel and its immediate surroundings fall in.
// This is the standard grid used across Israel, so plain 6-digit coordinate
// pairs are interpreted in it.
const UTM36N = "EPSG:32636";

// The plain-coordinate messages send a SHORTENED Northing: the full UTM 36N
// Northing for anywhere in Israel is ~3,200,000–3,700,000 (7 digits), but the
// messages drop the leading millions, sending only the lower 6 digits
// (e.g. "678000" means 3,678,000). We restore the millions by adding 3,000,000.
// Verified across all of Israel, from Rosh HaNikra (north) to Eilat (south).
const NORTHING_MILLIONS_OFFSET = 3_000_000;

export type latLon = [number, number];

/**
 * Converts a plain "Easting Northing" pair (6 digits each, as written in
 * messages) to [lon, lat]. The Easting is used as-is; the shortened Northing
 * is completed by adding the dropped 3,000,000, then projected from UTM 36N.
 *
 * NOTE: valid for coordinates within Israel and its immediate surroundings
 * (UTM zone 36, northern hemisphere, Northing in the 3.x-million band).
 */
export const TM9toLatLon = (match: RegExpExecArray): latLon => {
  const easting = Number(match[1]);
  const northing = Number(match[2]) + NORTHING_MILLIONS_OFFSET;
  return proj4(UTM36N, LATLONFORMAT, [easting, northing]) as latLon;
};

// Explicit "WGS84 UTM <zone>N <E>E <N>N" format — unchanged, independent path.
export const UTMtoLatLon = (match: RegExpExecArray): latLon =>
  proj4(`EPSG:326${match[1]}`, LATLONFORMAT, [Number(match[2]), Number(match[3])]) as latLon;
