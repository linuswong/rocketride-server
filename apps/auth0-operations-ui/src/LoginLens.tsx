import React, { useMemo, useState } from 'react';
import { LensTrend } from './LensTrend';
import { LensMap } from './LensMap';
import { LensInvestigation } from './LensInvestigation';
import { detect, thresholds, type Anomaly } from './lensRules';
import { classifyAnomaly, classifications } from './anomalyClassification';
import { manualContext, manualQuestions, isManual, type InvestigationContext, type Model } from './lensPlan';
import { withRequestTimeout } from './requestTimeout';
import { exampleEvents, exampleInventory } from './lensExample';
import { invokeRead, type ToolClient } from './operations';
import { normalize, summarize, type Event } from './loginLensAnalytics';
import './login-lens.css';

export type LensPage = 'Overview' | 'Analytics' | 'Anomaly Detection' | 'Investigations' | 'Settings';

export function LoginLens({ client, connected, startData, model, page = 'Overview', navigate = () => {}, renderAccountInvestigation }: {
 model: Model; client: ToolClient | null; connected: boolean; startData: () => Promise<string>; page?: LensPage;
 navigate?: (page: LensPage) => void; renderAccountInvestigation?: (active: boolean) => React.ReactNode;
}) {
 const [events, setEvents] = useState<Event[] | null>(null);
 const [skipped, setSkipped] = useState(0);
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(false);
 const [updated, setUpdated] = useState<number | null>(null);
 const [hours, setHours] = useState(24);
 const [loadedHours, setLoadedHours] = useState<number>();
 const [coverage, setCoverage] = useState('');
 const [application, setApplication] = useState('');
 const [sample, setSample] = useState(true);
 const [anchor] = useState(Date.now);
 const [selected, select] = useState<InvestigationContext>();
 const [group, setGroup] = useState('failures');
 const [question, setQuestion] = useState<string>(manualQuestions[0]);
 const [accountView, setAccountView] = useState(false);
 const openAnomaly = (anomaly: Anomaly) => { select(anomaly); setAccountView(false); navigate('Investigations'); };
 const refresh = async () => {
  if (!client || !connected || loading) return;
  select(undefined); setSkipped(0); setSample(false); setLoading(true); setError(''); setEvents(null); setUpdated(null); setLoadedHours(undefined); setCoverage('');
  try {
   const token = await withRequestTimeout(startData(), 'Connecting to the tenant', 45000);
   const end = Date.now();
   const result = await invokeRead(client, token, 'search_authentication_history', { start: new Date(end - hours * 3600000).toISOString(), end: new Date(end).toISOString() }, 180000);
   if (result.status !== 'success' || !Array.isArray(result.data?.events)) throw new Error(result.error ?? 'The log response was invalid.');
   const normalized = normalize(result.data.events);
   setEvents(normalized.events); setSkipped(normalized.skipped + Number(result.data.rejected)); setUpdated(end); setLoadedHours(hours); setApplication('');
   setCoverage(result.data.coverage === 'partial' ? `Partial retrieval · ${result.data.reason}${result.data.retry_after_seconds ? ` · Retry after ${result.data.retry_after_seconds} seconds` : ''}` : 'Query exhausted · Auth0 retention and search indexing may limit coverage');
  } catch (e) { setError(e instanceof Error ? e.message : 'Could not retrieve events.'); } finally { setLoading(false); }
 };
 const data = useMemo(() => sample ? summarize(exampleEvents(anchor), anchor, hours) : events && updated ? summarize(application ? events.filter(e => e.app === application) : events, updated, hours) : null, [sample, anchor, hours, events, updated, application]);
 const alerts = useMemo(() => detect(data?.selected ?? [], undefined, sample), [data, sample]);
 const displayInventory = sample ? exampleInventory(anchor) : null;
 const inventoryReady = displayInventory?.status === 'complete';
 const highPriority = alerts.filter(a => a.severity === 'High').length;
 const chosen = (data?.selected ?? []).filter(e => group === 'all' || (group === 'failures' ? e.kind === 'failure' : e.category === group));
 const openManual = () => {
  try { const end = sample ? anchor : updated!; select(manualContext(data?.selected ?? [], chosen.map(e => e.id), end - hours * 3600000, end, question)); setAccountView(false); navigate('Investigations'); }
  catch { setError('Select available events within the loaded time window.'); }
 };
 const currentSelection = () => !!selected && selected.events.every(e => (data?.selected ?? []).includes(e)) && (!isManual(selected) || (selected.end === (sample ? anchor : updated) && selected.start === selected.end - hours * 3600000));
 const manualControls = <section className="lens-card lens-manual">
  <h3>Investigate selected activity</h3><p>Choose a group in the selected time window. This does not assert that an anomaly occurred.</p>
  <div className="lens-manual-fields"><label>Event group <select value={group} onChange={e => setGroup(e.target.value)}><option value="failures">Failed sign-ins</option><option value="all">All authentication activity</option>{[...new Set((data?.selected ?? []).map(e => e.category))].sort().map(category => <option key={category} value={category}>{category}</option>)}</select></label>
  <label>Question <select value={question} onChange={e => setQuestion(e.target.value)}>{manualQuestions.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
  <button className="primary" disabled={!chosen.length || (!sample && loadedHours !== undefined && hours > loadedHours)} onClick={openManual}>Investigate {chosen.length} selected events</button>
  <p className="lens-foot">Selected events are from the loaded snapshot. Account-specific checks remain unavailable; coverage can be incomplete.</p>
 </section>;
 return <div className="lens">
  <div hidden={page !== 'Investigations' || !selected || accountView}>{selected && <LensInvestigation key={selected.id} anomaly={selected} client={client} model={sample ? undefined : model} analysisModel={connected ? model : undefined} start={() => withRequestTimeout(startData(), 'Starting read-only investigation', 45000)} contextValid={currentSelection} back={() => { select(undefined); navigate('Investigations'); }} />}</div>
  <div hidden={page !== 'Investigations' || !accountView}>{renderAccountInvestigation?.(page === 'Investigations' && accountView)}</div>
  <div hidden={page !== 'Investigations' || !!selected || accountView} className="lens-investigations">
   <header className="lens-investigations-header"><div><h1>Investigations</h1><p>Select activity from the current snapshot, review a detected anomaly, or investigate an account directly.</p></div></header>
   {manualControls}
   <section className="lens-card lens-investigation-options"><h3>Other investigation paths</h3><p>Review a detected anomaly or investigate an account directly.</p><div className="lens-option-actions"><button onClick={() => navigate('Anomaly Detection')}>View anomalies</button><button onClick={() => setAccountView(true)}>Investigate an account</button></div></section>
  </div>
  {page === 'Investigations' && (selected || accountView) && <button onClick={() => { select(undefined); setAccountView(false); }}>Investigation options</button>}
  <div hidden={page === 'Investigations' || page === 'Settings'}>
   <div className="lens-top"><div><span className="lens-kicker">LOGINLENS</span><h1>{page === 'Overview' ? 'Global authentication activity' : page}</h1></div><div className="lens-actions">
    <label>Time window <select value={hours} disabled={loading} onChange={e => setHours(Number(e.target.value))}><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select></label>
    <label>Application <select value={application} onChange={e => setApplication(e.target.value)}><option value="">All applications</option>{[...new Set((sample ? exampleEvents(anchor) : events ?? []).map(e => e.app))].sort().map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <button className="primary" disabled={!connected || loading} onClick={() => void refresh()}>{loading ? 'Loading…' : 'Load tenant events'}</button>
   </div></div>
   <div className="lens-notice" role="status">{sample ? 'Demo · synthetic authentication activity' : loading ? 'Retrieving tenant events…' : updated ? 'Tenant snapshot · ' + new Date(updated).toISOString() : 'Tenant snapshot unavailable'} · {connected ? 'Engine connected' : 'Engine offline'}{!sample && <> · {coverage || 'No history loaded'} · {skipped} excluded{loadedHours !== undefined && hours > loadedHours && ' · Selected range exceeds loaded history. Reload to retrieve it.'}{' '}<button disabled={loading} onClick={() => { setError(''); select(undefined); setSample(true); }}>View demo</button></>}</div>
   {error && <div className="banner error" role="alert">{error}</div>}
   {!sample && updated && <p className="lens-foot">Historical spike and rate comparisons are unavailable because tenant retention and search completeness have not been independently verified. Geographic and source concentrations describe only the retrieved window.</p>}
   {page !== 'Anomaly Detection' && <section className="lens-summary" aria-label="User activity and anomalies for the selected time window">
    <div className="lens-summary-heading"><div><span className="lens-kicker">SELECTED TIME WINDOW</span><h2>Users and activity</h2></div><span>{hours === 1 ? 'Last hour' : hours === 24 ? 'Last 24 hours' : 'Last 7 days'}</span></div>
    <div className="lens-kpis lens-user-summary">
     <article className="lens-metric lens-metric-anomalies"><span>Detected anomalies</span><strong>{data ? alerts.length : '—'}</strong><small>{data ? (alerts.length ? `${highPriority} high priority · Rule-based patterns to review` : 'No rules triggered in this window') : 'Load event data to check for patterns'}</small><button className="lens-metric-link" onClick={() => navigate('Anomaly Detection')}>Review anomalies →</button></article>
     <article className="lens-metric"><span>Active users · 30 days</span><strong>{inventoryReady ? displayInventory.active : '—'}</strong><small>{sample ? 'Last login within 30 days' : 'Unavailable'}</small></article>
     <article className="lens-metric"><span>Total users</span><strong>{inventoryReady ? displayInventory.total : '—'}</strong><small>{sample ? 'Synthetic demo inventory' : 'Unavailable'}</small></article>
     <article className="lens-metric"><span>Inactive users · 30 days</span><strong>{inventoryReady ? displayInventory.inactive : '—'}</strong><small>{sample ? 'Last login more than 30 days ago' : 'Unavailable'}</small></article>
    </div>
    <p className="lens-summary-note" role="status">{sample ? `Synthetic demo users · ${displayInventory?.unknown ?? 0} with unknown last login are excluded from active and inactive counts. Live user counts are unavailable because tenant user inventory is not loaded.` : 'User counts are unavailable because tenant user inventory is not loaded.'}</p>
   </section>}
   {page === 'Overview' && <LensMap events={data?.selected ?? []} alerts={alerts} select={openAnomaly} range={`Last ${hours} hours`} />}
   <div className="lens-layout">
    {page === 'Analytics' && manualControls}
    {(page === 'Analytics' || page === 'Overview') && <section className="lens-card"><span className="lens-kicker">EVENTS OVER TIME · UTC</span><h3>Sign-in activity</h3>{data && data.selected.length ? <LensTrend key={String(sample) + hours} buckets={data.buckets} hours={hours} /> : <p>{events ? 'No login events in this window.' : 'Refresh events to load the trend.'}</p>}</section>}
    {(page === 'Anomaly Detection' || page === 'Overview') && <section className="lens-card lens-alerts"><div className="lens-card-head"><div><span className="lens-kicker">ANOMALY MONITOR</span><h3>Priority anomalies</h3></div><button onClick={() => { setAccountView(true); navigate('Investigations'); }}>Investigate an account →</button></div>
     {(page === 'Overview' ? alerts.slice(0, 3) : alerts).map(a => <button className="lens-alert" key={a.id} onClick={() => openAnomaly(a)}><span className={'lens-risk ' + a.severity}>{a.severity}</span><strong>{classifications[classifyAnomaly(a).primary].label}</strong><span>{a.explanation}</span><span>{a.events.length} events →</span></button>)}
     {!alerts.length && <p>{data ? 'No rules triggered in this window.' : 'Awaiting event data.'}</p>}{page === 'Overview' && alerts.length > 3 && <button onClick={() => navigate('Anomaly Detection')}>View all {alerts.length} anomalies →</button>}
    </section>}
    {page === 'Analytics' && <section className="lens-card"><span className="lens-kicker">RETURNED EVENTS</span><h3>Failure categories</h3>{data && Object.keys(data.categories).length ? Object.entries(data.categories).map(([name, count]) => <div className="lens-category" key={name}><span>{name}</span><strong>{count}</strong></div>) : <p>{events ? 'No failed login events in this window.' : 'No data loaded.'}</p>}<p className="lens-foot">Failure rate uses failed and successful sign-ins. Sign-ups are counted separately.</p></section>}
   </div>
  </div>
  {page === 'Settings' && <section className="lens-card"><h1>Settings</h1><p>RocketRide engine: {connected ? 'Connected' : 'Disconnected'}</p><p>Auth0 access: read-only. Configure credentials and tenant permissions in the RocketRide engine.</p><p>AI provider: Gemini, configured in the RocketRide pipeline.</p><h3>Detection thresholds</h3><p>Repeated failures: {thresholds.repeated} in {thresholds.minutes} minutes · Possible spraying: {thresholds.accounts} accounts · Failure spike: {thresholds.spike} events.</p></section>}
 </div>;
}
