import React from 'react';
import type { Anomaly } from './lensRules';
export function AnomalyDetails({alerts,select}:{alerts:Anomaly[]; select:(a:Anomaly)=>void}) {
 return <div className="lens-map-detail"><strong>{alerts.length} {alerts.length === 1 ? 'anomaly' : 'anomalies'} at this location</strong>{alerts.map(a=><div key={a.id} className="lens-map-anomaly"><strong>{a.rule} · {a.severity}</strong><span>{new Date(a.start).toLocaleString()} – {new Date(a.end).toLocaleString()} · {new Set(a.events.map(e=>e.id)).size} events</span><span>{a.explanation}</span><small>{a.limitation}</small><button onClick={()=>select(a)}>Investigate</button></div>)}</div>;
}
