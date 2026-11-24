import React from 'react';
import { LensMap } from '../LensMap';
import { Card, Icon, type IconName } from './ui';
import { AnomalyList, InventoryCard, MetricsRow, OtherEventsCard, TrendCard } from './sections';
import { rangeLabel, type LensPage } from './pages';
import type { LensView } from './types';

type Feature = { page: LensPage; icon: IconName; title: string; text: string };

const features = (view: LensView): Feature[] => {
	const d = view.data;
	const waiting = view.loading ? 'Retrieving tenant events…' : 'Awaiting event data';
	const located = d ? d.selected.filter((e) => e.origin).length : 0;
	const count = view.alerts.length;
	return [
		{ page: 'Alerts', icon: 'shield', title: 'Anomaly detection', text: d ? (count ? `${count} ${count === 1 ? 'rule match' : 'rule matches'} · ${view.highPriority} high priority` : 'No rules triggered in this window') : waiting },
		{ page: 'Analytics', icon: 'analytics', title: 'Sign-in analytics', text: d ? (d.rate === null ? 'No sign-in attempts in this window' : `${d.rate.toFixed(1)}% failure rate across ${d.success + d.failure} attempts`) : waiting },
		{ page: 'Map', icon: 'map', title: 'Global activity map', text: d ? `${located} of ${d.selected.length} events include a network location` : waiting },
	];
};

export const LensOverview = ({ view }: { view: LensView }) => (
	<>
		<section className="lens-hero" aria-labelledby="lens-hero-title">
			<div className="lens-hero-copy">
				<span className="lens-kicker">OVERVIEW · {rangeLabel(view.hours).toUpperCase()}</span>
				<h1 id="lens-hero-title">Authentication insights at a glance</h1>
				<p>Analyze sign-in activity, surface rule-based anomalies and run read-only investigations across your Auth0 tenant.</p>
				<div className="lens-hero-actions">
					<button className="primary" onClick={() => view.navigate('Investigations')}>Investigate activity<Icon name="arrowRight" size={16} /></button>
					<button className="lens-button-ghost" onClick={() => view.navigate('Alerts')}>View alerts</button>
				</div>
			</div>
			<div className="lens-hero-cards">
				{features(view).map((feature, i) => (
					<button key={feature.page} className={`lens-glass lens-glass-${i}`} onClick={() => view.navigate(feature.page)}>
						<span className="lens-glass-icon"><Icon name={feature.icon} size={20} /></span>
						<strong>{feature.title}</strong>
						<span>{feature.text}</span>
					</button>
				))}
			</div>
		</section>
		<MetricsRow view={view} />
		<div className="lens-grid lens-grid-overview">
			<LensMap events={view.data?.selected ?? []} alerts={view.alerts} select={view.openAnomaly} range={rangeLabel(view.hours)} />
			<TrendCard view={view} />
		</div>
		<div className="lens-grid lens-grid-2">
			<Card kicker="ANOMALY MONITOR" title="Priority anomalies" className="lens-alerts"
				actions={<button className="lens-link" onClick={() => view.navigate('Alerts')}>{view.alerts.length > 3 ? `View all ${view.alerts.length}` : 'Open alerts'}<Icon name="arrowRight" size={14} /></button>}>
				<AnomalyList view={view} limit={3} />
			</Card>
			<InventoryCard view={view} />
		</div>
		<OtherEventsCard view={view} />
	</>
);
