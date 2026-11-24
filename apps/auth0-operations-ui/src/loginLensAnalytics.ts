export type Event = {
	id: string;
	time: number;
	kind: 'success' | 'failure' | 'signup' | 'protection';
	category: string;
	app: string;
	account?: number;
	source?: number;
	origin?: { lat: number; lon: number; label: string };
};
const failures: Record<string, string> = { f: 'Failed login', fp: 'Wrong password', fu: 'Unknown user' };
const protections: Record<string, string> = {
	limit_wc: 'Brute-force protection',
	limit_sul: 'Account rate limited',
	limit_mu: 'IP protection',
};
export type OtherEvent = { id: string; time: number; type: string; app: string };
export function otherEvents(rows: unknown[]): OtherEvent[] {
	const seen = new Set<string>();
	const result: OtherEvent[] = [];
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const e = row as Record<string, unknown>;
		const id = typeof e.log_id === 'string' ? e.log_id : '';
		const type = typeof e.type === 'string' ? e.type : '';
		const time = typeof e.date === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(e.date) ? Date.parse(e.date) : NaN;
		if (!id || !type || !Number.isFinite(time) || seen.has(id)) continue;
		seen.add(id);
		if (type === 's' || type === 'ss' || Object.hasOwn(failures, type) || Object.hasOwn(protections, type)) continue;
		result.push({ id, time, type, app: typeof e.client_name === 'string' && e.client_name ? e.client_name : 'Unknown application' });
	}
	return result.sort((a, b) => b.time - a.time);
}
export function normalize(rows: unknown[]): { events: Event[]; skipped: number } {
	const seen = new Set<string>();
	const events: Event[] = [];
	let skipped = 0;
	for (const row of rows) {
		if (!row || typeof row !== 'object') {
			skipped++;
			continue;
		}
		const e = row as Record<string, unknown>;
		const id = typeof e.log_id === 'string' ? e.log_id : '';
		const time =
			typeof e.date === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(e.date) ? Date.parse(e.date) : NaN;
		const type = typeof e.type === 'string' ? e.type : '';
		if (!id || !Number.isFinite(time) || !(type === 's' || type === 'ss' || Object.hasOwn(failures, type) || Object.hasOwn(protections, type))) {
			skipped++;
			continue;
		}
		if (seen.has(id)) {
			skipped++;
			continue;
		}
		seen.add(id);
		const lat = e.latitude,
			lon = e.longitude;
		const origin =
			typeof lat === 'number' && Math.abs(lat) <= 90 && typeof lon === 'number' && Math.abs(lon) <= 180
				? { lat, lon, label: `${lat}°, ${lon}°` }
				: undefined;
		const group = (value: unknown) =>
			typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
		events.push({
			id,
			time,
			kind: type === 'ss' ? 'signup' : type === 's' ? 'success' : Object.hasOwn(protections, type) ? 'protection' : 'failure',
			category: failures[type] ?? protections[type] ?? (type === 'ss' ? 'Successful sign-up' : 'Successful login'),
			app: typeof e.client_name === 'string' ? e.client_name : 'Unknown application',
			account: group(e.account_group),
			source: group(e.source_group),
			origin,
		});
	}
	return { events, skipped };
}
export function summarize(events: Event[], now: number, hours: number) {
	const selected = events.filter((e) => e.time >= now - hours * 3600000 && e.time <= now);
	const success = selected.filter((e) => e.kind === 'success').length;
	const failure = selected.filter((e) => e.kind === 'failure').length;
	const signups = selected.filter(e => e.kind === 'signup').length;
	const protection = selected.filter(e => e.kind === 'protection').length;
	const categories: Record<string, number> = {};
	selected
		.filter((e) => e.kind === 'failure')
		.forEach((e) => {
			categories[e.category] = (categories[e.category] ?? 0) + 1;
		});
	const buckets = Array.from({ length: 8 }, (_, i) => {
		const start = now - hours * 3600000 + (i * hours * 3600000) / 8;
		const end = now - hours * 3600000 + ((i + 1) * hours * 3600000) / 8;
		const group = selected.filter((e) => e.time >= start && (i === 7 ? e.time <= end : e.time < end));
		return {
			start,
			success: group.filter((e) => e.kind === 'success').length,
			failure: group.filter((e) => e.kind === 'failure').length,
		};
	});
	return {
		selected,
		success,
		failure,
		signups,
		protection,
		rate: success + failure ? (failure / (success + failure)) * 100 : null,
		categories,
		buckets,
	};
}
