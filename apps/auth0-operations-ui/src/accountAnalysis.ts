import { safeError } from './investigationErrors.ts';
import type { HistoryStop, Investigation, NodeId } from './investigation.ts';
import type { Evidence } from './operations.ts';

export type AccountAnalysisRecord = { evidence: Evidence; source: NodeId; page?: number };
type AccountAnalysisCheck = {reference:string; tool:string; status:'success' | 'error'; category?:string; count?:number | null; blocked?:boolean | null; email_verified?:boolean | null; has_blocks?:boolean | null; block_count?:number | null; page?:number | null; returned_count?:number; counted_events?:number; event_counts?:Record<string,number>; other_events?:number; duplicate_events?:number; missing_event_ids?:number};

/** Preserve the exact order used for anonymous model references and inspector links. */
export function accountAnalysisRecords(result: Investigation): AccountAnalysisRecord[] {
 return result.steps.flatMap(step => {
  if (!['search','profile','logs','blocks'].includes(step.id)) return [];
  if (['queued','running','skipped'].includes(step.state)) return [];
  if (step.state === 'failed' && step.evidence?.status === 'success') return [];
  if (step.id === 'logs' && result.accountHistory) {
   const pages = result.accountHistory.pages.map((evidence,index) => ({evidence,source:step.id,page:index+1}));
   if (result.accountHistory.error) pages.push({evidence:result.accountHistory.error,source:step.id,page:pages.length+1});
   return pages;
  }
  return step.evidence ? [{evidence:step.evidence,source:step.id,...(step.id === 'logs' ? {page:1} : {})}] : [];
 });
}

/** Only fixed categories and counts leave the browser; no provider strings or identities. */
export function accountAnalysisPayload(evidence: Evidence[], stop?: HistoryStop) {
 const allowedTools = new Set(['search_users','get_user','get_user_logs','get_user_blocks']);
 const types = ['s','f','fp','fu','gd_auth_failed','gd_auth_succeed','gd_auth_rejected','gd_otp_rate_limit_exceed','limit_wc','limit_sul','limit_mu'] as const;
 const boundedCount = (value:unknown, maximum:number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum ? value : null;
 const flag = (value:unknown) => typeof value === 'boolean' ? value : null;
 const seenEvents = new Set<string>();
 const checks = evidence.slice(0,12).flatMap<AccountAnalysisCheck>((item,index) => {
  if (!allowedTools.has(item.tool)) return [];
  const reference = `E${index + 1}`;
  if (item.status !== 'success' || !item.data) return [{reference,tool:item.tool,status:'error',category:safeError(item.error) ?? 'UNAVAILABLE'}];
  const data = item.data;
  if (item.tool === 'search_users') return [{reference,tool:item.tool,status:'success',count:boundedCount(data.count,20)}];
  if (item.tool === 'get_user') return [{reference,tool:item.tool,status:'success',blocked:flag(data.blocked),email_verified:flag(data.email_verified)}];
  if (item.tool === 'get_user_blocks') return [{reference,tool:item.tool,status:'success',has_blocks:flag(data.has_blocks),block_count:boundedCount(data.block_count,1000)}];
  const events = Array.isArray(data.events) ? data.events.slice(0,50) : [];
  const counts:Record<string,number> = Object.fromEntries(types.map(type => [type,0]));
  let other = 0, duplicateEvents = 0, missingIds = 0;
  for (const event of events) {
   const row = event && typeof event === 'object' ? event as Record<string,unknown> : {};
   const id = row.log_id;
   if (typeof id === 'string' && id.length > 0 && id.length <= 300) {
    if (seenEvents.has(id)) { duplicateEvents++; continue; }
    seenEvents.add(id);
   } else missingIds++;
   const type = row.type;
   if (typeof type === 'string' && types.some(item => item === type)) counts[type]++; else other++;
  }
  const page = item.input?.page === undefined ? 0 : boundedCount(item.input.page,4);
  return [{reference,tool:item.tool,status:'success',page:page === null ? null : page + 1, returned_count:events.length, counted_events:events.length-duplicateEvents, event_counts:counts, other_events:other, duplicate_events:duplicateEvents, missing_event_ids:missingIds}];
 });
 const stops:HistoryStop[] = ['no_incident_time','short_page','incident_window_reached','page_limit','read_failed','shared_failure','repeated_page'];
 return {
  checks,
  history_stop: stop && stops.includes(stop) ? stop : 'unknown',
  limitations: 'Only returned pages are summarized. Missing checks, retention, indexing, concurrent changes, and absent account identifiers can limit evidence. Records without event IDs may be duplicated. Auth0 success does not prove application access. MFA failure and success events can coexist while multiple OTP enrollments are checked; counts do not establish whether events belong to the same attempt.',
 };
}
