import clipping from 'polygon-clipping';
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

type Ring = [number, number][];
type PolygonCoordinates = Ring[];

// TopoJSON can encode a short edge over the date line as a 359-degree edge.
// Unwrap each ring, clip it to world-width strips, then shift the pieces back.
// The Antarctic polar cap intentionally spans the world and is left intact.
export function splitAntimeridian(collection: FeatureCollection<Polygon | MultiPolygon, { name: string }>): FeatureCollection<Polygon | MultiPolygon, { name: string }> {
 return { ...collection, features: collection.features.map(country => {
  if (country.id === '010' || country.properties.name === 'Antarctica') return country;
  const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
  const pieces: PolygonCoordinates[] = [];
  for (const polygon of polygons) {
   const crosses = polygon.some(ring => ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180));
   if (!crosses) { pieces.push(polygon as PolygonCoordinates); continue; }
   let unwrappedAnchor = 0;
   const unwrapped = polygon.map((ring, ringIndex) => {
    const result: Ring = [];
    for (const point of ring) {
     let lon = point[0];
     const reference = result.length ? result[result.length - 1][0] : ringIndex ? unwrappedAnchor : lon;
     while (lon - reference > 180) lon -= 360;
     while (lon - reference < -180) lon += 360;
     result.push([lon, point[1]]);
    }
    if (!ringIndex) unwrappedAnchor = result[0][0];
    return result;
   });
   const xs = unwrapped[0].map(p => p[0]);
   for (let world = Math.floor((Math.min(...xs) + 180) / 360); world <= Math.floor((Math.max(...xs) + 180) / 360); world++) {
    const west = -180 + 360 * world, east = 180 + 360 * world;
    const clip: PolygonCoordinates = [[[west,-90],[east,-90],[east,90],[west,90],[west,-90]]];
    for (const part of clipping.intersection(unwrapped, clip)) pieces.push(part.map(ring => ring.map(([lon,lat]) => [lon - 360 * world,lat])));
   }
  }
  return {...country, geometry:{type:'MultiPolygon' as const, coordinates:pieces as Position[][][]}};
 })};
}
