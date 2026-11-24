import React, { useEffect, useMemo, useState } from 'react';
import { LensMap } from './LensMap';
import { LensInvestigation } from './LensInvestigation';
import { detect, type Anomaly } from './lensRules';
import { manualContext, manualQuestions, isManual, type InvestigationContext, type Model } from './lensPlan';
import { withRequestTimeout } from './requestTimeout';
import { exampleEvents, exampleInventory } from './lensExample';
import { invokeRead, type ToolClient } from './operations';
import { normalize, otherEvents, summarize, type Event, type OtherEvent } from './loginLensAnalytics';
import { LensHeader } from './lens/LensHeader';
import { LensOverview } from './lens/LensOverview';
import { LensAnalytics } from './lens/LensAnalytics';
import { LensAlerts } from './lens/LensAlerts';
import { LensIntegrations } from './lens/LensIntegrations';
import { Icon, PageTitle } from './lens/ui';
import { rangeLabel, type LensPage } from './lens/pages';
import type { LensView } from './lens/types';
import './lens-tokens.css';
import './login-lens.css';

export type { LensPage } from './lens/pages';

export function LoginLens({ client, connected, startData, model, page = 'Overview', navigate = () => {}, renderAccountInvestigation, onAlertCount }: {
 model: Model; client: ToolClient | null; connected: boolean; startData: () => Promise<string>; page?: LensPage;
 navigate?: (page: LensPage) => void; renderAccountInvestigation?: (active: boolean) => React.ReactNode; onAlertCount?: (count: number | null) => void;
}) {
 const [events, setEvents] = useState<Event[] | null>(null);
 const [other, setOther] = useState<OtherEvent[]>([]);
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
 const openAccount = () => { setAccountView(true); navigate('Investigations'); };
 const refresh = async () => {
  if (!client || !connected || loading) return;
  select(undefined); setSkipped(0); setOther([]); setSample(false); setLoading(true); setError(''); setEvents(null); setUpdated(null); setLoadedHours(undefined); setCoverage('');
  try {
   const token = await withRequestTimeout(startData(), 'Connecting to the tenant', 45000);
   const end = Date.now();
   const result = await invokeRead(client, token, 'search_authentication_history', { start: new Date(end - hours * 3600000).toISOString(), end: new Date(end).toISOString() }, 180000);
   if (result.status !== 'success' || !Array.isArray(result.data?.events)) throw new Error(result.error ?? 'The log response was invalid.');
   const normalized = normalize(result.data.events);
   setEvents(normalized.events); setOther(otherEvents(result.data.events)); setSkipped(normalized.skipped + Number(result.data.rejected)); setUpdated(end); setLoadedHours(hours); setApplication('');
   setCoverage(result.data.coverage === 'partial' ? `Partial retrieval · ${result.data.reason}${result.data.retry_after_seconds ? ` · Retry after ${result.data.retry_after_seconds} seconds` : ''}` : 'Query exhausted · Auth0 retention and search indexing may limit coverage');
  } catch (e) { setError(e instanceof Error ? e.message : 'Could not retrieve events.'); } finally { setLoading(false); }
 };
 const data = useMemo(() => sample ? summarize(exampleEvents(anchor), anchor, hours) : events && updated ? summarize(application ? events.filter(e => e.app === application) : events, updated, hours) : null, [sample, anchor, hours, events, updated, application]);
 const visibleOther = !sample && updated ? other.filter(e => e.time >= updated - hours * 3600000 && e.time <= updated && (!application || e.app === application)) : [];
 const alerts = useMemo(() => detect(data?.selected ?? [], undefined, sample), [data, sample]);
 const displayInventory = sample ? exampleInventory(anchor) : null;
 const highPriority = alerts.filter(a => a.severity === 'High').length;
 const chosen = (data?.selected ?? []).filter(e => group === 'all' || (group === 'failures' ? e.kind === 'failure' : e.category === group));
 useEffect(() => { onAlertCount?.(data ? alerts.length : null); }, [data, alerts, onAlertCount]);
 const openManual = () => {
  try { const end = sample ? anchor : updated!; select(manualContext(data?.selected ?? [], chosen.map(e => e.id), end - hours * 3600000, end, question)); setAccountView(false); navigate('Investigations'); }
  catch { setError('Select available events within the loaded time window.'); }
 };
 const currentSelection = () => !!selected && selected.events.every(e => (data?.selected ?? []).includes(e)) && (!isManual(selected) || (selected.end === (sample ? anchor : updated) && selected.start === selected.end - hours * 3600000));
 const view: LensView = { data, alerts, highPriority, sample, loading, connected, updated, hours, skipped, otherEvents: visibleOther, inventory: displayInventory, navigate, openAnomaly, openAccount };
 const applications = [...new Set([...(sample ? exampleEvents(anchor) : events ?? []), ...(sample ? [] : other)].map(e => e.app))].sort();
 const manualControls = <section className="lens-card lens-manual">
  <div className="lens-card-head"><div className="lens-card-titles"><span className="lens-kicker">MANUAL INVESTIGATION · {rangeLabel(hours).toUpperCase()}</span><h3>Investigate selected activity</h3></div></div>
  <p>Choose a group in the selected time window. This does not assert that an anomaly occurred.</p>
  <div className="lens-manual-fields"><label>Event group <select value={group} onChange={e => setGroup(e.target.value)}><option value="failures">Failed sign-ins</option><option value="all">All authentication activity</option>{[...new Set((data?.selected ?? []).map(e => e.category))].sort().map(category => <option key={category} value={category}>{category}</option>)}</select></label>
  <label>Question <select value={question} onChange={e => setQuestion(e.target.value)}>{manualQuestions.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
  <button className="primary" disabled={!chosen.length || (!sample && loadedHours !== undefined && hours > loadedHours)} onClick={openManual}>Investigate {chosen.length} selected events</button>
  <p className="lens-foot">Selected events are from the loaded snapshot. Account follow-ups use verified source events; coverage can be incomplete.</p>
 </section>;
 const dataPage = page === 'Overview' || page === 'Map' || page === 'Analytics' || page === 'Alerts';
 return <div className="lens lens-root">
  <div hidden={page !== 'Investigations' || !selected || accountView}>{selected && <LensInvestigation key={selected.id} anomaly={selected} client={client} model={sample ? undefined : model} snapshotEvents={data?.selected ?? []} start={() => withRequestTimeout(startData(), 'Starting read-only investigation', 45000)} contextValid={currentSelection} back={() => { select(undefined); navigate('Investigations'); }} />}</div>
  <div hidden={page !== 'Investigations' || !accountView} className="lens-account-view"><button className="lens-back" onClick={() => setAccountView(false)}><Icon name="arrowLeft" size={16} />Investigation options</button>{renderAccountInvestigation?.(page === 'Investigations' && accountView)}</div>
  <div hidden={page !== 'Investigations' || !!selected || accountView} className="lens-investigations">
   <PageTitle kicker="READ-ONLY INVESTIGATIONS" title="Investigations" description="Select activity from the current snapshot, review a detected anomaly, or investigate an account directly." />
   <div className="lens-grid lens-grid-investigations">
    {manualControls}
    <section className="lens-card lens-investigation-options">
     <div className="lens-card-head"><div className="lens-card-titles"><span className="lens-kicker">OTHER PATHS</span><h3>Other investigation paths</h3></div></div>
     <p>Review a detected anomaly or investigate an account directly.</p>
     <div className="lens-option-actions">
      <button className="lens-option" onClick={() => navigate('Alerts')}><Icon name="alerts" /><span><strong>View anomalies</strong><small>{data ? `${alerts.length} detected in this window` : 'Requires loaded events'}</small></span></button>
      <button className="lens-option" onClick={() => setAccountView(true)}><Icon name="users" /><span><strong>Investigate an account</strong><small>Email address or Auth0 user ID</small></span></button>
     </div>
    </section>
   </div>
  </div>
  {dataPage && <div className="lens-page">
   <LensHeader view={view} controls={{ setHours, application, setApplication, applications, refresh: () => void refresh(), coverage, loadedHours, viewDemo: () => { setError(''); select(undefined); setSample(true); } }} />
   {error && <div className="banner error" role="alert">{error}</div>}
   {page === 'Overview' && <LensOverview view={view} />}
   {page === 'Map' && <>
    <PageTitle kicker="MAP" title="Global activity map" description="Where sign-ins in the loaded window originate. Select a country or an anomaly marker to inspect it." />
    <LensMap full events={data?.selected ?? []} alerts={alerts} select={openAnomaly} range={rangeLabel(hours)} />
   </>}
   {page === 'Analytics' && <LensAnalytics view={view} manualControls={manualControls} />}
   {page === 'Alerts' && <LensAlerts view={view} />}
  </div>}
  {page === 'Integrations' && <div className="lens-page"><LensIntegrations view={view} /></div>}
 </div>;
}
