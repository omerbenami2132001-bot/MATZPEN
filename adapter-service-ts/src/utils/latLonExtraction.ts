import proj4 from "proj4";
import espg2039 from "epsg-index/s/2039.json";

const LATLONFORMAT = "EPSG:4326";
const TM9FORMAT = "EPSG:2039";

proj4.defs(TM9FORMAT, espg2039.proj4);

export type latLon = [number, number];

export const TM9toLatLon = (match: RegExpExecArray) =>
  proj4(TM9FORMAT, LATLONFORMAT, [Number(match[1]), Number(match[2])]) as latLon;

export const UTMtoLatLon = (match: RegExpExecArray) =>
  proj4(`EPSG:326${match[1]}`, LATLONFORMAT, [Number(match[2]), Number(match[3])]) as latLon;
