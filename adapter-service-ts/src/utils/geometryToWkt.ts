
interface Geometry {
  type: string;
  coordinates: any;
}

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
