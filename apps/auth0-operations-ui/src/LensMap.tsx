import React, { useMemo, useState } from 'react';
import type { Event } from './loginLensAnalytics';
import type { Anomaly } from './lensRules';
import { geographicData, type ActivityFilter } from './lensGeography';
import { useLensMap } from './useLensMap';
import { RegionDetails } from './LensRegionDetails';
import { AnomalyDetails } from './LensAnomalyDetails';

export function LensMap({events,alerts,select,range = 'Selected time range'}:{events:Event[]; alerts:Anomaly[]; select:(a:Anomaly)=>void; range?:string}) {
 const [filter,setFilter]=useState<ActivityFilter>('all');
 const [region,setRegion]=useState<{id:string;name:string}>();
 const [markerIds,setMarkerIds]=useState<string[]>([]);
 const data=useMemo(()=>geographicData(events,alerts,filter),[events,alerts,filter]);
 const {container,mapRef,status,retry}=useLensMap(data,(id,name)=>{setRegion({id,name});setMarkerIds([]);},ids=>{setMarkerIds(ids);setRegion(undefined);});
 const selectedAlerts=alerts.filter(a=>markerIds.includes(a.id));
 return <section className="lens-card lens-origin">
  <div className="lens-card-head"><div><span className="lens-kicker">GLOBAL ACTIVITY</span><h3>Authentication origins</h3></div><div className="lens-actions lens-map-actions">
   <label>Activity <select aria-label="Activity filter" value={filter} onChange={e=>setFilter(e.target.value as ActivityFilter)}><option value="all">All logins</option><option value="success">Successful</option><option value="failure">Failed</option></select></label>
   <button disabled={status !== 'ready'} aria-label="Zoom out" onClick={()=>mapRef.current?.zoomOut()}>−</button><button disabled={status !== 'ready'} aria-label="Zoom in" onClick={()=>mapRef.current?.zoomIn()}>+</button><button disabled={status !== 'ready'} onClick={()=>mapRef.current?.flyTo({center:[0,15],zoom:0.8})}>Fit map</button>
  </div></div>
  <div ref={container} className={'lens-atlas' + (status === 'unavailable' || status === 'lost' ? ' lens-atlas-unavailable' : '')} aria-label="Interactive authentication origin map" />
  {(status === 'unavailable' || status === 'lost') && <div className="lens-map-fallback" role="status">
   <strong>{status === 'lost' ? 'Map display interrupted' : 'Map unavailable'}</strong>
   <p>{status === 'lost' ? 'The browser lost its graphics context. It may restore the map automatically.' : 'The browser could not start the graphics needed for the map.'} You can still review detected anomalies below.</p>
   <button onClick={retry}>Retry map</button>
   {alerts.length > 0 && <div className="lens-map-fallback-alerts">{alerts.map(a => <button key={a.id} onClick={() => select(a)}>{a.severity} · {a.rule} →</button>)}</div>}
  </div>}
  {status === 'ready' && <div className="lens-map-key" aria-label="Map legend"><span>● Activity density</span><span>● Anomaly</span></div>}
  {status === 'ready' && <div className="map-caption">{region ? <RegionDetails name={region.name} stats={data.stats.get(region.id)} range={range}/> : selectedAlerts.length ? <AnomalyDetails alerts={selectedAlerts} select={select}/> : <span>Select a country or a red anomaly marker to inspect activity.</span>}
   <small>{data.missing} events without valid coordinates · Heat shows login activity, not maliciousness · Country boundaries: Natural Earth</small>
  </div>}
 </section>;
}
