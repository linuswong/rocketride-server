import { origins, exampleEvents } from './lensExample';
import React, { useState } from 'react';
import { invokeRead, type ToolClient } from './operations';
import { normalize, summarize, type Event } from './loginLensAnalytics';
import './login-lens.css';

export function LoginLens({client, connected, start, investigate}: {client:ToolClient|null; connected:boolean; start:()=>Promise<string>; investigate:()=>void}) {
 const [events,setEvents] = useState<Event[] | null>(null); const [skipped,setSkipped] = useState(0); const [error,setError] = useState(''); const [loading,setLoading] = useState(false); const [updated,setUpdated] = useState<number|null>(null); const [hours,setHours] = useState(24);
 const [sample,setSample] = useState(true);
 const [anchor] = useState(Date.now);
 const [place,setPlace] = useState('London');
 const refresh = async () => {
  if (!client || !connected || loading) return;
  setSample(false); setLoading(true); setError(''); setEvents(null); setUpdated(null);
  try {
   const token = await start(); const result = await invokeRead(client,token,'search_logs',{limit:50});
   if (result.status !== 'success' || !Array.isArray(result.data?.events)) throw new Error(result.error ?? 'The log response was invalid.');
   const normalized = normalize(result.data.events); setEvents(normalized.events); setSkipped(normalized.skipped); setUpdated(Date.now());
  } catch (e) { setError(e instanceof Error ? e.message : 'Could not retrieve events.'); } finally { setLoading(false); }
 };
 const data = sample ? summarize(exampleEvents(anchor),anchor,hours) : events && updated ? summarize(events,updated,hours) : null;
 const max = data ? Math.max(1,...data.buckets.map(b=>b.success+b.failure)) : 1;
 return <div className="lens"><div className="lens-top"><div><span className="lens-kicker">LOGINLENS</span><h1>Authentication activity</h1></div><div className="lens-actions"><label>Time window <select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select></label><button className="primary" disabled={!connected || loading} onClick={()=>void refresh()}>{loading ? 'Loading…' : 'Load tenant events'}</button></div></div>
 <div className="lens-notice" role="status">{sample ? 'Demo · synthetic authentication activity' : updated ? 'Tenant snapshot · ' + new Date(updated).toISOString() : 'Tenant snapshot unavailable'} · {connected ? 'Engine connected' : 'Engine offline'}{!sample && <> · Latest page only (50 maximum) · {skipped} excluded <button disabled={loading} onClick={()=>setSample(true)}>View demo</button></>}</div>
 {error && <div className="banner error" role="alert">{error}</div>}
 <div className="lens-kpis">{[['Login events',data?.selected.length],['Successful events',data?.success],['Failed events',data?.failure],['Failure-event rate',data ? data.rate === null ? 'N/A' : `${data.rate.toFixed(1)}%` : undefined]].map(([label,value])=><article key={label}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}</div>
 <div className="lens-layout"><section className="lens-card lens-origin"><div className="lens-card-head"><div><span className="lens-kicker">GLOBAL ACTIVITY</span><h3>Authentication origin</h3></div><span className="lens-badge">{sample ? 'DEMO ORIGINS' : 'TENANT LOGS'}</span></div>
 <div className="origin-map">{sample && origins.map(o=><button key={o.name} title={o.name} aria-label={o.name} aria-pressed={place===o.name} onClick={()=>setPlace(o.name)} style={{left:(o.lon+180)/3.6+'%',top:(85-o.lat)/1.45+'%'}} />)}</div>
 <div className="map-caption">{sample ? <><strong>{place}</strong><span>{data?.selected.filter(e=>e.app===place && e.kind==='success').length} successful · {data?.selected.filter(e=>e.app===place && e.kind==='failure').length} failed</span></> : <span>Unknown location · The connector omits event coordinates.</span>}</div></section>
 <section className="lens-card"><span className="lens-kicker">INVESTIGATION</span><h3>Trace a sign-in</h3><p>Inspect an account’s recent events and protection checks in the investigation graph.</p><button onClick={investigate}>Open investigation →</button></section></div>
 <div className="lens-layout"><section className="lens-card"><span className="lens-kicker">EVENTS OVER TIME · UTC</span><h3>Sign-in activity</h3>{data && data.selected.length ? <><div className="lens-chart" aria-label="Login event counts over time">{data.buckets.map(b=><div className="lens-bar-col" key={b.start} title={`${new Date(b.start).toISOString()}: ${b.success} successes, ${b.failure} failures`}><div className="lens-bars"><span style={{height:`${b.success/max*100}%`}}/><span style={{height:`${b.failure/max*100}%`}}/></div><small>{new Date(b.start).toISOString().slice(hours > 24 ? 5 : 11,hours > 24 ? 10 : 16)}</small></div>)}</div><p><span className="lens-blue">●</span> Success &nbsp; <span className="lens-orange">●</span> Failure · bucket starts in UTC</p></> : <p>{events ? 'No login events in this window.' : 'Refresh events to load the trend.'}</p>}</section><section className="lens-card"><span className="lens-kicker">RETURNED EVENTS</span><h3>Failure categories</h3>{data && Object.keys(data.categories).length ? Object.entries(data.categories).map(([name,count])=><div className="lens-category" key={name}><span>{name}</span><strong>{count}</strong></div>) : <p>{events ? 'No failed login events in this window.' : 'No data loaded.'}</p>}<p className="lens-foot">Based on Auth0 event types f, fp and fu. Other event types are excluded.</p></section></div>
 </div>;
}
