export type Event = { id: string; time: number; kind: 'success' | 'failure'; category: string; app: string };
const failures: Record<string,string> = { f: 'Failed login', fp: 'Wrong password', fu: 'Unknown user' };
export function normalize(rows: unknown[]): { events: Event[]; skipped: number } {
 const seen = new Set<string>(); const events: Event[] = []; let skipped = 0;
 for (const row of rows) {
  if (!row || typeof row !== 'object') { skipped++; continue; }
  const e = row as Record<string, unknown>;
  const id = typeof e.log_id === 'string' ? e.log_id : '';
  const time = typeof e.date === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(e.date) ? Date.parse(e.date) : NaN;
  const type = typeof e.type === 'string' ? e.type : '';
  if (!id || !Number.isFinite(time) || (type !== 's' && !failures[type])) { skipped++; continue; }
  if (seen.has(id)) { skipped++; continue; } seen.add(id);
  events.push({ id, time, kind: type === 's' ? 'success' : 'failure', category: failures[type] ?? 'Successful login', app: typeof e.client_name === 'string' && e.client_name ? e.client_name : 'Unknown application' });
 }
 return { events, skipped };
}
export function summarize(events: Event[], now: number, hours: number) {
 const selected = events.filter(e => e.time >= now - hours * 3600000 && e.time <= now);
 const success = selected.filter(e => e.kind === 'success').length; const failure = selected.length - success;
 const categories: Record<string,number> = {};
 selected.filter(e => e.kind === 'failure').forEach(e => { categories[e.category] = (categories[e.category] ?? 0) + 1; });
 const buckets = Array.from({length: 8}, (_, i) => {
  const start = now - hours * 3600000 + i * hours * 3600000 / 8;
  const end = now - hours * 3600000 + (i + 1) * hours * 3600000 / 8;
  const group = selected.filter(e => e.time >= start && (i === 7 ? e.time <= end : e.time < end));
  return { start, success: group.filter(e => e.kind === 'success').length, failure: group.filter(e => e.kind === 'failure').length };
 });
 return { selected, success, failure, rate: selected.length ? failure / selected.length * 100 : null, categories, buckets };
}
