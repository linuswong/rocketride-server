/** A user-selected lead, not an authorization or identity assertion. */
export type AccountLeadLink = 'direct' | 'email_candidate' | 'mixed' | 'mfa_event' | 'event_user' | 'submitted_email';
export type SourceEvent = {id:string; type:string; time:string};
export function validSourceEvent(value:SourceEvent | undefined): SourceEvent | undefined {
 if (!value || typeof value.id !== 'string' || typeof value.type !== 'string' || typeof value.time !== 'string' || !/^[A-Za-z0-9_.:-]{1,300}$/.test(value.id) || !['f','fp','fu','gd_auth_failed','gd_auth_rejected','gd_otp_rate_limit_exceed'].includes(value.type) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.time) || !Number.isFinite(Date.parse(value.time))) return;
 return value;
}
export type AccountPrefill = ({requestId:string; userId:string; link:Exclude<AccountLeadLink,'submitted_email'>} | {requestId:string; email:string; link:'submitted_email'}) & {eventTime?:string; sourceEvent?:SourceEvent};
export function accountLeadLabel(link:AccountLeadLink): string {
 return {direct:'direct event link',email_candidate:'email-linked candidate',mixed:'direct links and email candidates',mfa_event:'user ID reported by an MFA event; profile not checked at selection',event_user:'user ID reported by a failed-login event; profile not checked at selection',submitted_email:'email submitted in a failed-login event; event does not establish an account link'}[link];
}
