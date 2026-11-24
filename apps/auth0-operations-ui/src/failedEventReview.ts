import { supportedEmail, validateTarget } from './investigation.ts';
import type { Event } from './loginLensAnalytics.ts';
import type { Evidence } from './operations.ts';

const codes:Record<string,string> = {'Failed login':'f','Wrong password':'fp','Unknown user':'fu'};
export function failureEventType(event:Event): string | undefined { return event.kind === 'failure' && Object.hasOwn(codes,event.category) ? codes[event.category] : undefined; }

/** An event-reported ID or email is a lead; it does not prove actor identity. */
export function failedEventLead(event:Event, evidence:Evidence): {kind:'user_id' | 'email'; value:string} | {kind:'no_lead'} | {kind:'mismatch'} {
 const data=evidence.data;
 if (!failureEventType(event) || evidence.status !== 'success' || !data || data.log_id !== event.id || data.type !== failureEventType(event) || typeof data.date !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(data.date) || Date.parse(data.date) !== event.time) return {kind:'mismatch'};
 if (typeof data.user_id === 'string' && data.user_id === data.user_id.trim() && !validateTarget(data.user_id,'user_id')) return {kind:'user_id',value:data.user_id};
 if (typeof data.user_name === 'string' && data.user_name === data.user_name.trim() && supportedEmail(data.user_name)) return {kind:'email',value:data.user_name};
 return {kind:'no_lead'};
}
