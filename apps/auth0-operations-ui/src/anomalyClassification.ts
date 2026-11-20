import type { Anomaly } from './lensRules';

export type ClassificationId =
	| 'repeated_account_failures' | 'potential_password_spraying' | 'geographic_anomaly'
	| 'authentication_failure_spike' | 'protection_activity' | 'configuration_issue' | 'insufficient_evidence';

export const classifications: Record<ClassificationId, { label: string; questions: readonly string[] }> = {
	repeated_account_failures: {
		label: 'Repeated account failures',
		questions: ['Do failures share an account and time window?', 'Do they share an observed source?', 'What protection settings are available?', 'Could a stale credential or client issue explain the failures?'],
	},
	potential_password_spraying: {
		label: 'Potential password spraying',
		questions: ['How many observed accounts share a source?', 'Are failures concentrated in time?', 'What protection settings and events are available?', 'Could shared network egress explain the pattern?'],
	},
	geographic_anomaly: {
		label: 'Geographic anomaly',
		questions: ['How does tenant activity compare with the preceding window?', 'Which observed events failed or succeeded?', 'Could traffic volume, a proxy or approximate location explain the concentration?'],
	},
	authentication_failure_spike: {
		label: 'Authentication failure spike',
		questions: ['How do failure counts compare with the observed baseline?', 'Did overall traffic volume change?', 'What failure categories appear in the returned events?'],
	},
	protection_activity: {
		label: 'Protection-related activity',
		questions: ['What protection event was observed?', 'Which relevant protections are currently enabled?', 'Does the observed event establish a block for this account?'],
	},
	configuration_issue: {
		label: 'Possible authentication configuration issue',
		questions: ['Are failures concentrated in an application or connection?', 'Which error details are actually available?', 'What configuration evidence can be inspected without assuming a cause?'],
	},
	insufficient_evidence: {
		label: 'Unknown or insufficient evidence',
		questions: ['Which events and timestamps are available?', 'What additional evidence is needed before determining a cause?'],
	},
};

const ruleClasses: Record<string, ClassificationId> = {
	'Repeated account failures': 'repeated_account_failures',
	'Possible password spraying': 'potential_password_spraying',
	'Geographic concentration': 'geographic_anomaly',
	'Failure volume spike': 'authentication_failure_spike',
	'Failure rate deviation': 'authentication_failure_spike',
	'Protection activity': 'protection_activity',
	'Configuration issue': 'configuration_issue',
};

export type ClassifiedAnomaly = {
	primary: ClassificationId;
	secondary: ClassificationId[];
	severity: Anomaly['severity'];
	rule: string;
	evidence: Anomaly['events'];
	start: number;
	end: number;
	limitation: string;
	reasoning: string[];
	questions: string[];
};

/** Classification describes evidence and questions, never a confirmed attack or cause. */
export function classifyAnomaly(anomaly: Anomaly): ClassifiedAnomaly {
	const evidence = anomaly.events ?? [];
	const failures = evidence.filter(e => e.kind === 'failure');
	const primary = evidence.length ? (ruleClasses[anomaly.rule] ?? 'insufficient_evidence') : 'insufficient_evidence';
	const secondary: ClassificationId[] = [];
	const reasoning = [evidence.length ? anomaly.explanation : 'No supporting events are available for classification.'];
	const counts = (field: 'account' | 'source') => {
		const groups = new Map<number, number>();
		for (const event of failures) {
			const key = event[field];
			if (key !== undefined) groups.set(key, (groups.get(key) ?? 0) + 1);
		}
		return groups;
	};
	const accounts = counts('account');
	const sources = counts('source');
	const add = (id: ClassificationId, reason: string) => {
		if (id !== primary && !secondary.includes(id)) { secondary.push(id); reasoning.push(reason); }
	};
	if ([...accounts.values()].some(count => count >= 4))
		add('repeated_account_failures', 'At least four supporting events share an observed account group.');
	if ([...sources.keys()].some(source => new Set(failures.filter(e => e.source === source && e.account !== undefined).map(e => e.account)).size >= 4))
		add('potential_password_spraying', 'Supporting events include at least four account groups sharing a source group.');
	const locations = new Map<string, number>();
	for (const event of failures) if (event.origin) {
		const key = event.origin.lat + ',' + event.origin.lon;
		locations.set(key, (locations.get(key) ?? 0) + 1);
	}
	if ([...locations.values()].some(count => count >= 6 && count / failures.length >= 0.6))
		add('geographic_anomaly', 'At least six supporting events share an approximate network location.');
	if (evidence.some(e => ['Brute-force protection', 'Account rate limited', 'IP protection'].includes(e.category)))
		add('protection_activity', 'A supporting event indicates protection-related activity.');
	if (evidence.some(e => e.category === 'Authentication configuration error'))
		add('configuration_issue', 'A supporting event is classified as a configuration error.');
	const questions = [...new Set([primary, ...secondary].flatMap(id => classifications[id].questions))];
	return {primary, secondary, severity: anomaly.severity, rule: anomaly.rule, evidence,
		start: anomaly.start, end: anomaly.end, limitation: anomaly.limitation, reasoning, questions};
}
