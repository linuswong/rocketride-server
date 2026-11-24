import React, { useMemo } from 'react';
import { BarList } from './charts/BarList';
import { Card, EmptyState, Icon, PageTitle, StatusPill } from './ui';
import { AnomalyList } from './sections';
import type { LensView } from './types';

const RECENT_FAILURE_LIMIT = 50;

export const LensAlerts = ({ view }: { view: LensView }) => {
	const d = view.data;
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
			<Card kicker="CONTEXT · NOT ALERTS" title="Ordinary failed sign-ins" className="lens-failures">
				<p>Failed sign-ins are common in normal traffic, such as mistyped passwords. They appear here for context; only the patterns above matched a detection rule. A failure that is part of an anomaly is marked.</p>
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
								<thead><tr><th>Time (UTC)</th><th>Category</th><th>Application</th><th>Detection</th></tr></thead>
								<tbody>
									{failures.slice(0, RECENT_FAILURE_LIMIT).map((e) => (
										<tr key={e.id}>
											<td>{new Date(e.time).toISOString().slice(0, 19).replace('T', ' ')}</td>
											<td>{e.category}</td>
											<td>{e.app}</td>
											<td>{anomalyEvents.has(e.id) ? <span className="lens-chip lens-chip-danger">Part of an anomaly</span> : <span className="lens-chip">No rule matched</span>}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				)}
			</Card>
		</>
	);
};
