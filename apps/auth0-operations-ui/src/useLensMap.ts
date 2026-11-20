import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, type GeoJSONSource, type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { addDataLayers, mapStyle } from './lensMapLayers';
import type { geographicData } from './lensGeography';

type Data = ReturnType<typeof geographicData>;
export function useLensMap(data: Data, onRegion: (id:string, name:string)=>void, onMarkers:(ids:string[])=>void) {
 const container = useRef<HTMLDivElement>(null); const mapRef = useRef<Map>();
 const [status, setStatus] = useState<'loading' | 'ready' | 'lost' | 'unavailable'>('loading');
 const [attempt, setAttempt] = useState(0);
 const latest = useRef({data,onRegion,onMarkers}); latest.current = {data,onRegion,onMarkers};
 useEffect(()=>{
  if (!container.current) return;
  const element = container.current;
  setStatus('loading');
  let map: Map;
  try {
   map = new MapLibreMap({container:element,style:mapStyle,center:[0,15],zoom:0.8,minZoom:0.5});
  } catch {
   // MapLibre may leave its canvas behind if WebGL creation fails during construction.
   element.replaceChildren();
   element.classList.remove('maplibregl-map');
   setStatus('unavailable');
   return;
  }
  mapRef.current=map;
  map.on('webglcontextlost', () => setStatus('lost'));
  map.on('webglcontextrestored', () => setStatus('ready'));
  let hover: string | number | undefined; let selected: string | number | undefined;
  const update = () => { if (!map.style) return; const activity = map.getSource('activity') as GeoJSONSource | undefined; const anomalies = map.getSource('anomalies') as GeoJSONSource | undefined; activity?.setData(latest.current.data.points); anomalies?.setData(latest.current.data.anomalies); };
  map.on('style.load', update);
  map.on('load',()=>{
   addDataLayers(map); update(); setStatus('ready');
   map.on('mousemove','countries',e=>{ const id=e.features?.[0]?.id; if (hover !== undefined) map.setFeatureState({source:'countries',id:hover},{hover:false}); hover=id; if (id !== undefined) map.setFeatureState({source:'countries',id},{hover:true}); });
   map.on('mouseleave','countries',()=>{if (hover !== undefined) map.setFeatureState({source:'countries',id:hover},{hover:false}); hover=undefined;});
   map.on('click', async e=>{
    const markers=map.queryRenderedFeatures(e.point,{layers:['anomaly-hit']});
    if (markers.length) {
     if (selected !== undefined) map.setFeatureState({source:'countries',id:selected},{selected:false});
     selected=undefined;
     const m=markers[0];
     if (m.properties?.cluster) {
      const leaves=await (map.getSource('anomalies') as GeoJSONSource).getClusterLeaves(Number(m.properties.cluster_id),10000,0);
      latest.current.onMarkers([...new Set(leaves.flatMap(f=>JSON.parse(String(f.properties?.ids ?? '[]')) as string[]))]);
     } else latest.current.onMarkers(JSON.parse(String(m.properties?.ids ?? '[]')));
     return;
    }
    const country=map.queryRenderedFeatures(e.point,{layers:['countries']})[0];
    if (!country || country.id === undefined) return;
    if (selected !== undefined) map.setFeatureState({source:'countries',id:selected},{selected:false}); selected=country.id;
    map.setFeatureState({source:'countries',id:selected},{selected:true}); latest.current.onRegion(String(country.id),String(country.properties?.name ?? 'Unknown region'));
   });
  });
  const observer = new ResizeObserver(()=>map.resize()); observer.observe(container.current);
  return ()=>{ observer.disconnect(); map.remove(); mapRef.current=undefined; };
 },[attempt]);
 useEffect(()=>{const map=mapRef.current; if (map?.style && map.getSource('activity') && map.getSource('anomalies')) { (map.getSource('activity') as GeoJSONSource).setData(data.points); (map.getSource('anomalies') as GeoJSONSource).setData(data.anomalies); }},[data]);
 return {container,mapRef,status,retry: () => setAttempt(value => value + 1)};
}
