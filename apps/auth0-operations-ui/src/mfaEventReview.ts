import { validateTarget } from './investigation.ts';
import { mfaSignalLabel, type OtherEvent } from './loginLensAnalytics.ts';
import type { Evidence } from './operations.ts';

/** Match provider details to the selected snapshot before using its reported account ID. */
export function mfaEventAccount(event: OtherEvent, evidence: Evidence): {kind:'matched'; userId:string} | {kind:'no_user'} | {kind:'mismatch'} {
 const data = evidence.data;
 if (evidence.status !== 'success' || !data || !mfaSignalLabel(event.type) || data.log_id !== event.id || data.type !== event.type || typeof data.date !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(data.date) || Date.parse(data.date) !== event.time) return {kind:'mismatch'};
 if (typeof data.user_id !== 'string' || data.user_id !== data.user_id.trim() || validateTarget(data.user_id,'user_id')) return {kind:'no_user'};
 return {kind:'matched',userId:data.user_id};
}
