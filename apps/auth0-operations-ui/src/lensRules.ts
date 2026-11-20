import type { Event } from './loginLensAnalytics';

export const thresholds = {
	minutes: 15,
	repeated: 4,
	accounts: 4,
	geographic: 6,
	share: 0.6,
	spike: 6,
	multiplier: 3,
	baselineWindows: 6,
};
export type Anomaly = {
	id: string;
	rule: string;
	severity: 'High' | 'Moderate';
	explanation: string;
	limitation: string;
	events: Event[];
	start: number;
	end: number;
};

// Use the strongest observed window for each rule and grouping within the selected range.
export function detect(events: Event[], config = thresholds, baselineCoverage = true): Anomaly[] {
	const ordered = [...events].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
	const failures = ordered.filter((e) => e.kind === 'failure');
	const span = config.minutes * 60000;
	const alerts = new Map<string, Anomaly>();
	for (const last of failures) {
		const end = last.time,
			start = end - span;
		const window = failures.filter((e) => e.time > start && e.time <= end);
		function flag(
			rule: string,
			key: string,
			evidence: Event[],
			severity: Anomaly['severity'],
			explanation: string,
			limitation: string
		) {
			const group = rule + '/' + key;
			if ((alerts.get(group)?.events.length ?? 0) >= evidence.length) return;
			alerts.set(group, {
				id: group + '/' + end,
				rule,
				severity,
				events: evidence,
				start,
				end,
				explanation,
				limitation,
			});
		}
		const account = window.filter((e) => e.account === last.account);
		if (last.account && account.length >= config.repeated)
			flag(
				'Repeated account failures',
				String(last.account),
				account,
				'Moderate',
				`${account.length} failures share one account in ${config.minutes} minutes.`,
				'Retries or a stale credential can look similar. Some failure events do not include an account identifier.'
			);
		const source = window.filter((e) => e.source === last.source && e.account);
		const accounts = new Set(source.map((e) => e.account)).size;
		if (last.source && accounts >= config.accounts)
			flag(
				'Possible password spraying',
				String(last.source),
				source,
				'High',
				`One network source recorded failures for ${accounts} accounts.`,
				'Shared egress can group independent users. Some failure events omit account identifiers.'
			);
		if (last.origin) {
			const { lat, lon } = last.origin;
			const local = window.filter((e) => e.origin?.lat === lat && e.origin.lon === lon);
			if (local.length >= config.geographic && local.length / window.length >= config.share)
				flag(
					'Geographic concentration',
					lat + ',' + lon,
					local,
					'Moderate',
					`${local.length} of ${window.length} observed failures share a network origin.`,
					'Network geolocation is approximate and may reflect a proxy.'
				);
		}
		const previous = (offset: number) =>
			ordered.filter((e) => e.time > start - offset * span && e.time <= end - offset * span);
		const prior = previous(1);
		if (
			baselineCoverage &&
			prior.some(e => e.kind === 'success' || e.kind === 'failure') &&
			ordered[0].time <= start - span &&
			window.length >= config.spike &&
			window.length >= config.multiplier * Math.max(1, prior.filter((e) => e.kind === 'failure').length)
		)
			flag(
				'Failure volume spike',
				'all',
				window,
				'High',
				`Failures increased from ${prior.filter((e) => e.kind === 'failure').length} to ${window.length} in adjacent windows.`,
				'Traffic volume and page limits can affect the comparison.'
			);
		const history = Array.from({ length: config.baselineWindows }, (_, i) => previous(i + 1));
		if (
			!baselineCoverage ||
			ordered[0].time > start - history.length * span ||
			history.some((bin) => !bin.some((e) => e.kind === 'success' || e.kind === 'failure'))
		)
			continue;
		const historical = history.flat().filter((e) => e.kind === 'success' || e.kind === 'failure');
		const current = ordered.filter((e) => (e.kind === 'success' || e.kind === 'failure') && e.time > start && e.time <= end);
		const historicalRate = historical.filter((e) => e.kind === 'failure').length / historical.length;
		if (
			window.length >= config.spike &&
			window.length / current.length >= config.multiplier * Math.max(0.05, historicalRate)
		)
			flag(
				'Failure rate deviation',
				'all',
				window,
				'Moderate',
				`Current failure rate exceeds the reference rate (${Math.round(historicalRate * 100)}%) across ${history.length} preceding windows.`,
				'This local baseline does not establish seasonal or long-term behavior.'
			);
	}
	for (const event of ordered.filter(e => e.kind === 'protection')) {
		const related = [...alerts.values()].find(alert => event.time > alert.start && event.time <= alert.end &&
			alert.events.some(other => (event.account !== undefined && event.account === other.account) ||
				(event.source !== undefined && event.source === other.source)));
		if (related) {
			related.events.push(event);
			related.limitation += ' A protection event shares an observed group; this does not establish intent or causation.';
			continue;
		}
		const grouped = [...alerts.values()].find(alert => alert.rule === 'Protection activity' &&
			event.time <= alert.start + 2 * span &&
			alert.events.some(other => (event.account !== undefined && event.account === other.account) ||
				(event.source !== undefined && event.source === other.source)));
		if (grouped) {
			grouped.events.push(event);
			grouped.end = event.time;
			continue;
		}
		const key = 'protection/' + event.id;
		alerts.set(key, { id:key+'/'+event.time, rule:'Protection activity', severity:'Moderate',
			explanation:'An Auth0 protection event was observed.', limitation:'Protection events do not establish malicious intent; identity and coverage may be incomplete.',
			events:[event], start:event.time-span, end:event.time });
	}
	return [...alerts.values()].sort(
		(a, b) =>
			Number(b.severity === 'High') - Number(a.severity === 'High') || b.events.length - a.events.length
	);
}
