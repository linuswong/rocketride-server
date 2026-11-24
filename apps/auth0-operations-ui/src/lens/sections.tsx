import React from 'react';
import { classifyAnomaly, classifications } from '../anomalyClassification';
import { Card, EmptyState, Icon, Metric } from './ui';
import { TrendChart } from './charts/TrendChart';
import { rangeLabel } from './pages';
import { dataState, type LensView } from './types';

const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)}%`;

export const MetricsRow = ({ view }: { view: LensView }) => {
	const state = dataState(view);
	const d = view.data;
	const attempts = d ? d.success + d.failure : 0;
	const idle = 'Load tenant events';
	const excludedState = view.sample ? 'unavailable' : view.loading ? 'loading' : view.updated !== null ? 'ready' : 'unavailable';
	return (
		<section className="lens-metrics" aria-label={`Sign-in metrics · ${rangeLabel(view.hours)}`}>
			<Metric icon="users" label="Successful sign-ins" state={state} value={d?.success}
				caption={d ? (attempts ? `${percent(d.success, attempts)} of ${attempts} sign-in attempts` : 'No sign-in attempts in this window') : idle} />
			<Metric icon="failure" tone="danger" label="Failed sign-ins" state={state} value={d?.failure}
				caption={d ? `${d.rate === null ? 'No sign-in attempts' : `${d.rate.toFixed(1)}% failure rate`}${d.protection ? ` · ${d.protection} protection events` : ''}` : idle} />
			<Metric icon="userPlus" label="Sign-ups" state={state} value={d?.signups} caption={d ? 'Counted separately from sign-ins' : idle} />
			<Metric icon="filter" tone="neutral" label="Excluded events" state={excludedState} value={view.skipped}
				caption={view.sample ? 'Not applicable to demo data' : view.updated !== null ? 'Not counted in sign-in analytics' : idle} />
		</section>
	);
};

export const TrendCard = ({ view }: { view: LensView }) => (
	<Card kicker="EVENTS OVER TIME · UTC" title="Sign-in trend" className="lens-trend-card" actions={<span className="lens-chip">{rangeLabel(view.hours)}</span>}>
		{view.data && view.data.selected.length ? (
			<TrendChart key={String(view.sample) + view.hours} buckets={view.data.buckets} hours={view.hours} />
		) : view.loading ? (
			<div className="lens-skeleton-block" aria-label="Loading trend" />
		) : (
			<EmptyState icon="analytics" title={view.data ? 'No sign-in events in this window' : 'No trend loaded'}>
				{view.data ? 'Choose a longer date range to see more activity.' : 'Load tenant events to chart sign-in activity.'}
			</EmptyState>
		)}
	</Card>
);

export const AnomalyList = ({ view, limit }: { view: LensView; limit?: number }) => {
	const items = limit ? view.alerts.slice(0, limit) : view.alerts;
	if (!items.length)
		return (
			<EmptyState icon="shield" title={view.data ? 'No rules triggered in this window' : view.loading ? 'Checking for patterns…' : 'Awaiting event data'}>
				{view.data ? 'Failed sign-ins may still occur; none matched a detection rule.' : 'Load tenant events or view the demo to run detection rules.'}
			</EmptyState>
		);
	return (
		<ul className="lens-alert-list">
			{items.map((a) => (
				<li key={a.id}>
					<button className="lens-alert" onClick={() => view.openAnomaly(a)}>
						<span className={'lens-risk ' + a.severity}>{a.severity}</span>
						<span className="lens-alert-body">
							<strong>{classifications[classifyAnomaly(a).primary].label}</strong>
							<span>{a.explanation}</span>
							<small>{a.rule} · {new Date(a.end).toISOString().slice(0, 16).replace('T', ' ')} UTC</small>
						</span>
						<span className="lens-alert-count">{a.events.length} events <Icon name="arrowRight" size={16} /></span>
					</button>
				</li>
			))}
		</ul>
	);
};

export const InventoryCard = ({ view }: { view: LensView }) => {
	const inventory = view.inventory?.status === 'complete' ? view.inventory : null;
	const items = [
		{ label: 'Active users · 30 days', value: inventory?.active, caption: view.sample ? 'Last login within 30 days' : 'Unavailable' },
		{ label: 'Total users', value: inventory?.total, caption: view.sample ? 'Synthetic demo inventory' : 'Unavailable' },
		{ label: 'Inactive users · 30 days', value: inventory?.inactive, caption: view.sample ? 'Last login more than 30 days ago' : 'Unavailable' },
	];
	return (
		<Card kicker="USER INVENTORY" title="Users" className="lens-summary">
			<div className="lens-user-summary">
				{items.map((item) => (
					<article key={item.label} className="lens-inventory-item">
						<span>{item.label}</span>
						<strong>{item.value ?? '—'}</strong>
						<small>{item.caption}</small>
					</article>
				))}
			</div>
			<p className="lens-summary-note" role="status">
				{view.sample
					? `Synthetic demo users · ${view.inventory?.unknown ?? 0} with unknown last login are excluded from active and inactive counts. Live user counts are unavailable because tenant user inventory is not loaded.`
					: 'User counts are unavailable because tenant user inventory is not loaded.'}
			</p>
		</Card>
	);
};

export const OtherEventsCard = ({ view }: { view: LensView }) => {
	if (view.sample || !view.updated) return null;
	return (
		<Card kicker="EXCLUDED FROM SIGN-IN ANALYTICS" title={`Other tenant events (${view.otherEvents.length})`} className="lens-other-events">
			<p>These event types do not contribute to sign-in metrics or anomaly rules. Times are UTC; types are Auth0 log codes.</p>
			{view.otherEvents.length ? (
				<div className="lens-other-table lens-table">
					<table>
						<thead><tr><th>Time (UTC)</th><th>Event type</th><th>Application</th></tr></thead>
						<tbody>
							{view.otherEvents.map((e) => (
								<tr key={e.id}>
									<td>{new Date(e.time).toISOString()}</td>
									<td>{e.type === 'mgmt_api_read' ? 'API read operation' : e.type === 'seccft' ? 'Client credentials exchange' : 'Other event'} <small>({e.type})</small></td>
									<td>{e.app}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p>No other events returned in this window.</p>
			)}
		</Card>
	);
};
