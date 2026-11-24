/** An investigation time requests at most one hour on either side, ending no later than now. */
export function submittedEmailWindow(incidentTime: string, now = Date.now()): {start:string; end:string} | undefined {
 const incident = Date.parse(incidentTime);
 if (!Number.isFinite(incident) || !Number.isFinite(now) || incident > now) return;
 const start = incident - 3600000, end = Math.min(incident + 3600000, now);
 if (end <= start) return;
 return {start:new Date(start).toISOString(), end:new Date(end).toISOString()};
}
import type { Evidence } from './operations.ts';

/** Describe the requested window, not provider coverage or indexing freshness. */
export function submittedEmailWindowDescription(evidence: Evidence | undefined, incidentTime: string): string | undefined {
 if (evidence?.status !== 'success') return;
 const start = evidence.input?.start, end = evidence.input?.end;
 if (typeof start !== 'string' || typeof end !== 'string' || !observationTime(start) || !observationTime(end)) return;
 const from = Date.parse(start), to = Date.parse(end), incident = Date.parse(incidentTime);
 if (!(from < to)) return;
 const shortened = Number.isFinite(incident) && to < incident + 3600000;
 return `Requested tenant-log window (UTC): ${start} to ${end}.${shortened ? ' This search ended less than one hour after the investigation time; later events were outside this search.' : ''} The query checks the submitted email in Auth0 user_name. Different usernames, missing fields, retention or indexing can hide events.`;
}

/** Local observation time is not a provider timestamp or proof of freshness. */
export function observedEvidence(evidence: Evidence, now = Date.now()): Evidence {
 return {...evidence,observedAt:new Date(now).toISOString()};
}

export function observationTime(value: unknown): string | undefined {
 return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function pageObservationLines(evidence?: Evidence): string[] {
 const entries = evidence?.data?.page_observations;
 if (!Array.isArray(entries)) return [];
 return entries.slice(0,5).flatMap(item => item && typeof item === 'object' && Number.isInteger(item.page) && item.page >= 1 && item.page <= 5 && observationTime(item.time) ? [`Page ${item.page} response received at ${item.time} (browser clock).`] : []);
}

/** Keep prior successful evidence visible while marking a later refresh failure. */
export function withRefreshFailure(previous?: Evidence, failure?: Evidence): Evidence | undefined {
 if (previous?.status !== 'success' || failure?.status !== 'error') return previous;
 return {...previous,data:{...previous.data,refresh_error:failure.error ?? 'UNAVAILABLE'}};
}


/** Preserve page provenance and deduplicate returned IDs without claiming complete coverage. */
export function mergeSubmittedEmailPages(first?: Evidence, later: Evidence[] = [], error?: Evidence): Evidence | undefined {
 if (!first || first.status !== 'success' || !Array.isArray(first.data?.events)) return first;
 const pages = [first,...later];
 const seen = new Set<string>(); const events: Record<string,unknown>[] = [];
 let duplicates = 0, rejected = 0, repeated = false;
 for (const [index,page] of pages.entries()) {
  if (page.status !== 'success' || !Array.isArray(page.data?.events)) continue;
  let fresh = 0;
  for (const raw of page.data.events) {
   if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
   const event = raw as Record<string,unknown>, id = event.log_id;
   if (typeof id === 'string' && id) { if (seen.has(id)) { duplicates++; continue; } seen.add(id); }
   fresh++; events.push({...event,source_page:index+1});
  }
  if (index > 0 && page.data.events.length > 0 && fresh === 0) repeated = true;
  if (typeof page.data.rejected === 'number') rejected += page.data.rejected;
 }
 const pageObservations = pages.flatMap((page,index) => observationTime(page.observedAt) ? [{page:index+1,time:page.observedAt}] : []);
 return {...first,data:{...first.data,events,count:events.length,rejected,page_full:pages[pages.length-1].data?.page_full === true, pages_read:pages.length,duplicate_count:duplicates,repeated_page:repeated,page_observations:pageObservations,...(error ? {additional_error:error.error ?? 'UNAVAILABLE'} : {})}};
}
