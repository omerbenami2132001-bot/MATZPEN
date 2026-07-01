import { multiPoint } from "@turf/turf";
import { GeoJSONGeometry, GeoJSONGeometryCollection, GeoJSONMultiPoint, GeoJSONPoint } from "wellknown";

interface Geometry {
  type: string;
  coordinates: any;
}

const getUniqueGeometries = <T extends Exclude<GeoJSON.Geometry, GeoJSON.GeometryCollection>>(
  geometries: T[]
) => {
  const seen = new Set<string>();

  return geometries.filter((p) => {
    const key = JSON.stringify(p.coordinates);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) as T[];
};

export const combinePoints = (points: GeoJSONPoint[]) => {
  if (!points.length) return null;

  const uniquePoints = getUniqueGeometries(points);

  return uniquePoints.length === 1 ? uniquePoints[0] : multiPoint(uniquePoints.map((p) => p.coordinates))["geometry"] as GeoJSONMultiPoint;
};

export const geometryToWkt = (geometry: Geometry): string | null => {
  if (!geometry || !geometry.type || !geometry.coordinates) return null;

  const { type, coordinates } = geometry;

  switch (type) {
    case "Point":
      return `POINT(${coordinates[0]} ${coordinates[1]})`;

    case "LineString":
      return `LINESTRING(${coordinates.map((point: number[]) => `${point[0]} ${point[1]}`).join(", ")})`;

    case "Polygon": {
      const rings = coordinates
        .map((ring: number[][]) => `(${ring.map((point) => `${point[0]} ${point[1]}`).join(", ")})`)
        .join(", ");
      return `POLYGON(${rings})`;
    }

    case "MultiPoint":
      return `MULTIPOINT(${coordinates.map((point: number[]) => `${point[0]} ${point[1]}`).join(", ")})`;

    default:
      return null;
  }
};

export const geometriesToWkt = (geometries: Geometry[]): string[] => {
  if (!Array.isArray(geometries)) return [];
  return geometries
    .map((geometry) => geometryToWkt(geometry))
    .filter((wkt): wkt is string => wkt !== null);
};
