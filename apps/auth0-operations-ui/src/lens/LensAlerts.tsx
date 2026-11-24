import React, { useMemo, useState } from 'react';
import { MfaEventReview } from './MfaEventReview';
import { FailedEventReview } from './FailedEventReview';
import type { ToolClient } from '../operations';
import { mfaSignalLabel, type Event, type OtherEvent } from '../loginLensAnalytics';
import { BarList } from './charts/BarList';
import { Card, EmptyState, Icon, PageTitle, StatusPill } from './ui';
import { AnomalyList } from './sections';
import type { LensView } from './types';

const RECENT_FAILURE_LIMIT = 50;

export const LensAlerts = ({ view, client, start, openMfaAccount, openFailureAccount }: { view: LensView; client:ToolClient | null; start:()=>Promise<string>; openMfaAccount?:(id:string,event:OtherEvent)=>void; openFailureAccount?:(lead:{kind:'user_id' | 'email'; value:string},event:Event)=>void }) => {
	const d = view.data;
	const [selectedMfa,setSelectedMfa] = useState<string>();
	const [selectedFailure,setSelectedFailure] = useState<string>();
	const mfaEvents = view.otherEvents.filter(event => mfaSignalLabel(event.type));
	const failures = useMemo(() => (d ? d.selected.filter((e) => e.kind === 'failure').sort((a, b) => b.time - a.time) : []), [d]);
	const anomalyEvents = useMemo(() => new Set(view.alerts.flatMap((a) => a.events.map((e) => e.id))), [view.alerts]);
	const outsideAnomalies = failures.filter((e) => !anomalyEvents.has(e.id)).length;
	const categories = d ? Object.entries(d.categories).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, tone: 'neutral' as const })) : [];
	return (
		<>
			<PageTitle kicker="ALERTS" title="Alerts"
				description="Detected anomalies are rule-based patterns worth reviewing. Ordinary failed sign-ins are listed separately and are not alerts on their own."
				actions={<button onClick={view.openAccount}>Investigate an account<Icon name="arrowRight" size={14} /></button>} />
			{d && (
				<div className="lens-alert-summary" role="status">
					<StatusPill tone={view.alerts.length ? 'danger' : 'accent'}>{view.alerts.length} detected {view.alerts.length === 1 ? 'anomaly' : 'anomalies'}</StatusPill>
					{view.highPriority > 0 && <StatusPill tone="danger">{view.highPriority} high priority</StatusPill>}
					<StatusPill tone="neutral">{failures.length} failed sign-ins · {outsideAnomalies} outside any anomaly</StatusPill>
				</div>
			)}
			<Card kicker="ANOMALY MONITOR" title="Detected anomalies" className="lens-alerts">
				<AnomalyList view={view} />
			</Card>
			<Card kicker="MFA CONTEXT · NOT RULE ALERTS" title="MFA events for review" className="lens-mfa-events">
				<p>These returned events are separate from sign-in counts and anomaly rules. An MFA failure can coexist with a success, and a rate-limit event does not establish the current status or identity of the person affected. Compare the time with the reported issue. Newly seen markers remain while events are returned in comparable snapshots; marking one seen does not resolve it.</p>
				{view.sample ? <p>MFA events are not included in the demo snapshot.</p> : !d ? <p>Load tenant events to review MFA activity.</p> : !mfaEvents.length ? <p>No supported MFA failure or OTP rate-limit events returned in this snapshot.</p> : <div className="lens-table"><table><caption>Most recent {Math.min(RECENT_FAILURE_LIMIT,mfaEvents.length)} of {mfaEvents.length} returned MFA events (UTC)</caption><thead><tr><th>Time (UTC)</th><th>Event</th><th>Application</th><th>Review</th></tr></thead><tbody>{mfaEvents.slice(0,RECENT_FAILURE_LIMIT).map(event=><tr key={event.id}><td>{new Date(event.time).toISOString()}</td><td>{mfaSignalLabel(event.type)} <small>({event.type})</small>{view.newMfaIds.includes(event.id) && <> · <span className="lens-chip">Newly seen · awaiting review</span></>}</td><td>{event.app}</td><td><button type="button" disabled={!view.eventReviewAvailable} onClick={()=>setSelectedMfa(event.id)} aria-label={`Review ${mfaSignalLabel(event.type)} at ${new Date(event.time).toISOString()}`}>Review event</button>{view.newMfaIds.includes(event.id) && <button type="button" onClick={()=>view.markFailureSeen(event.id)} aria-label={`Mark ${mfaSignalLabel(event.type)} at ${new Date(event.time).toISOString()} seen`}>Mark seen</button>}</td></tr>)}</tbody></table></div>}
				{!view.sample && !view.loading && view.eventReviewAvailable && selectedMfa && mfaEvents.find(event=>event.id === selectedMfa) && <MfaEventReview key={`${view.updated}-${selectedMfa}`} event={mfaEvents.find(event=>event.id === selectedMfa)!} client={client} connected={view.connected} start={start} openAccount={openMfaAccount ? id=>openMfaAccount(id,mfaEvents.find(event=>event.id === selectedMfa)!) : undefined}/>}
				<p>To investigate a reported user, open an account investigation and enter a confirmed identifier. These rows do not establish an account link.</p><button type="button" onClick={view.openAccount}>Investigate reported account</button>
			</Card>
			<Card kicker="CONTEXT · NOT ALERTS" title="Ordinary failed sign-ins" className="lens-failures">
				<p>Failed sign-ins are common in normal traffic, such as mistyped passwords. They appear here for context; only the patterns above matched a detection rule. A failure that is part of an anomaly is marked. Review a row to prepare an investigation; no additional checks run until you start them. Newly seen markers stay while events remain in comparable snapshots, until marked seen. Marking an event seen does not resolve it.</p>
				{!d ? (
					<EmptyState icon="failure" title={view.loading ? 'Retrieving tenant events…' : 'No data loaded'}>Load tenant events or view the demo.</EmptyState>
				) : !failures.length ? (
					<EmptyState icon="check" title="No failed sign-ins in this window" />
				) : (
					<div className="lens-failures-body">
						<BarList items={categories} label="Failed sign-ins by category" />
						<div className="lens-table">
							<table>
								<caption>Most recent {Math.min(RECENT_FAILURE_LIMIT, failures.length)} of {failures.length} failed sign-ins (UTC)</caption>
								<thead><tr><th>Time (UTC)</th><th>Category</th><th>Application</th><th>Detection</th><th>Review</th></tr></thead>
								<tbody>
									{failures.slice(0, RECENT_FAILURE_LIMIT).map((e) => (
										<tr key={e.id}>
											<td>{new Date(e.time).toISOString().slice(0, 19).replace('T', ' ')}</td>
											<td>{e.category}{view.newFailureIds.includes(e.id) && <> · <span className="lens-chip">Newly seen · awaiting review</span></>}</td>
											<td>{e.app}</td>
											<td>{anomalyEvents.has(e.id) ? <span className="lens-chip lens-chip-danger">Part of an anomaly</span> : <span className="lens-chip">No rule matched</span>}</td>
											<td><button type="button" disabled={!view.eventReviewAvailable} onClick={() => view.openEvent(e)} aria-label={`Review ${e.category} at ${new Date(e.time).toISOString()}`}>Review event</button><button type="button" disabled={!view.eventReviewAvailable || view.sample || !view.connected} onClick={()=>setSelectedFailure(e.id)} aria-label={`Check account lead for ${e.category} at ${new Date(e.time).toISOString()}`}>Check account lead</button>{view.newFailureIds.includes(e.id) && <button type="button" onClick={() => view.markFailureSeen(e.id)} aria-label={`Mark ${e.category} at ${new Date(e.time).toISOString()} seen`}>Mark seen</button>}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				)}
				{!view.sample && !view.loading && view.eventReviewAvailable && selectedFailure && failures.find(event=>event.id===selectedFailure) && <FailedEventReview key={`${view.updated}-${selectedFailure}`} event={failures.find(event=>event.id===selectedFailure)!} client={client} connected={view.connected} start={start} openAccount={openFailureAccount ? lead=>openFailureAccount(lead,failures.find(event=>event.id===selectedFailure)!) : undefined}/>}
			</Card>
		</>
	);
};
