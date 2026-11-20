import { feature } from 'topojson-client';
import topology from 'world-atlas/countries-110m.json' with { type: 'json' };
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import type { Topology } from 'topojson-specification';
import type { Event } from './loginLensAnalytics';
import type { Anomaly } from './lensRules';
import { splitAntimeridian } from './lensAntimeridian.ts';

type Country = Feature<Polygon | MultiPolygon, { name: string }>;
export const countries = splitAntimeridian(feature(topology as unknown as Topology, (topology as any).objects.countries) as unknown as FeatureCollection<Polygon | MultiPolygon, { name: string }>);
export type RegionStats = { name: string; accounts: number; success: number; failure: number; protection: number; anomalies: number };
export type ActivityFilter = 'all' | 'success' | 'failure';
export function validOrigin(e: Event): boolean {
 return !!e.origin && Number.isFinite(e.origin.lat) && Number.isFinite(e.origin.lon) && Math.abs(e.origin.lat) <= 90 && Math.abs(e.origin.lon) <= 180;
}
export function geographicData(events: Event[], alerts: Anomaly[], filter: ActivityFilter) {
 const unique = new Map(events.map(e => [e.id, e]));
 const activity = new Map<string, { lon: number; lat: number; count: number }>();
 const regions = new Map<string, { country: Country; events: Event[]; alerts: Set<string> }>();
 const lookup = new Map<string, string | undefined>();
 function region(e: Event) {
  if (!validOrigin(e)) return undefined;
  const {lon, lat} = e.origin!; const key = `${lon},${lat}`;
  if (!lookup.has(key)) {
   const point: Feature<Point> = { type:'Feature', properties:{}, geometry:{type:'Point', coordinates:[lon,lat]} };
   lookup.set(key, countries.features.find(c => booleanPointInPolygon(point, c))?.id?.toString());
  }
  return lookup.get(key);
 }
 for (const e of unique.values()) {
  const id = region(e);
  if (id) {
   let group = regions.get(id);
   if (!group) { group = { country: countries.features.find(c => String(c.id) === id)!, events: [], alerts:new Set() }; regions.set(id, group); }
   group.events.push(e);
  }
  if (validOrigin(e) && (e.kind === 'success' || e.kind === 'failure') && (filter === 'all' || filter === e.kind)) {
   const {lon, lat} = e.origin!; const key = `${lon},${lat}`;
   const item = activity.get(key) ?? {lon, lat, count:0}; item.count++; activity.set(key,item);
  }
 }
 const markers = new Map<string, { lon:number; lat:number; ids:Set<string> }>();
 for (const alert of alerts) for (const evidence of alert.events) {
  // Associate by stable ID, not object identity; never include events outside the selected dataset.
  const e = unique.get(evidence.id); if (!e || !validOrigin(e)) continue;
  const id = region(e); if (id) regions.get(id)?.alerts.add(alert.id);
  const {lon,lat} = e.origin!; const key = `${lon},${lat}`;
  const marker = markers.get(key) ?? {lon,lat,ids:new Set<string>()}; marker.ids.add(alert.id); markers.set(key,marker);
 }
 const stats = new Map<string, RegionStats>();
 for (const [id, group] of regions) stats.set(id, {name:group.country.properties.name, accounts:new Set(group.events.flatMap(e => e.account === undefined ? [] : [e.account])).size, success:group.events.filter(e=>e.kind === 'success').length, failure:group.events.filter(e=>e.kind === 'failure').length, protection:group.events.filter(e=>e.kind === 'protection').length, anomalies:group.alerts.size});
 const points: FeatureCollection<Point> = {type:'FeatureCollection', features:[...activity.values()].map(({lon,lat,count})=>({type:'Feature', properties:{count}, geometry:{type:'Point',coordinates:[lon,lat]}}))};
 const anomalies: FeatureCollection<Point> = {type:'FeatureCollection', features:[...markers.values()].map(({lon,lat,ids})=>({type:'Feature', properties:{ids:JSON.stringify([...ids]), count:ids.size}, geometry:{type:'Point',coordinates:[lon,lat]}}))};
 return {points, anomalies, stats, missing:[...unique.values()].filter(e=>!validOrigin(e)).length};
}
