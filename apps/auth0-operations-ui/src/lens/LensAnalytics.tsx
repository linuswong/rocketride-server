import React from 'react';
import { BarList, type BarItem } from './charts/BarList';
import { Card, EmptyState, Icon, PageTitle } from './ui';
import { TrendCard } from './sections';
import type { LensView } from './types';

const ruleItems = (view: LensView): BarItem[] => {
	const rules = new Map<string, { count: number; events: number; high: boolean }>();
	for (const alert of view.alerts) {
		const entry = rules.get(alert.rule) ?? { count: 0, events: 0, high: false };
		rules.set(alert.rule, { count: entry.count + 1, events: entry.events + alert.events.length, high: entry.high || alert.severity === 'High' });
	}
	return [...rules].sort((a, b) => b[1].count - a[1].count).map(([rule, entry]) => ({
		label: rule,
		value: entry.count,
		tone: entry.high ? 'danger' : 'warning',
		meta: `${entry.events} supporting events · ${entry.high ? 'High' : 'Moderate'} priority`,
	}));
};

export const LensAnalytics = ({ view, manualControls }: { view: LensView; manualControls: React.ReactNode }) => {
	const d = view.data;
	const categories: BarItem[] = d ? Object.entries(d.categories).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, tone: 'danger' })) : [];
	const rules = ruleItems(view);
	return (
		<>
			<PageTitle kicker="ANALYTICS" title="Analytics" description="Sign-in volume, failure categories and rule-based unusual activity for the selected window." />
			<TrendCard view={view} />
			<div className="lens-grid lens-grid-2">
				<Card kicker="RETURNED EVENTS" title="Failure categories" actions={d && d.rate !== null ? <span className="lens-chip lens-chip-danger">{d.rate.toFixed(1)}% failure rate</span> : undefined}>
					{categories.length ? (
						<BarList items={categories} label="Failed sign-ins by category" />
					) : (
						<EmptyState icon="failure" title={d ? 'No failed sign-ins in this window' : 'No data loaded'}>{d ? undefined : 'Load tenant events to break down failures.'}</EmptyState>
					)}
					<p className="lens-foot">Failure rate uses failed and successful sign-ins. Sign-ups are counted separately.</p>
				</Card>
				<Card kicker="DETECTION RULES" title="Unusual activity"
					actions={<button className="lens-link" onClick={() => view.navigate('Alerts')}>Review alerts<Icon name="arrowRight" size={14} /></button>}>
					{rules.length ? (
						<BarList items={rules} label="Detected anomalies by rule" />
					) : (
						<EmptyState icon="shield" title={d ? 'No rules triggered in this window' : 'No data loaded'}>{d ? undefined : 'Detection rules run on loaded events.'}</EmptyState>
					)}
					<p className="lens-foot">Counts are rule matches in the loaded window, not confirmed incidents.</p>
				</Card>
			</div>
			{manualControls}
		</>
	);
};
