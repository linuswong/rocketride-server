import { accountLeadLabel, validSourceEvent, type AccountLeadLink, type SourceEvent } from './accountPrefill.ts';
import { accountLogEvents, findings, investigationRecommendation, targetType, type Investigation } from './investigation.ts';
import type { Evidence } from './operations.ts';
import { safeError } from './investigationErrors.ts';
import { observationTime, pageObservationLines, submittedEmailWindowDescription } from './submittedEmail.ts';

export type ReportedIssueCategory = 'password' | 'mfa' | 'identifier' | 'redirect';

const reportedIssues: Record<ReportedIssueCategory, {label: string; advice: string}> = {
 password: {label:'Password or credentials', advice:"Confirm the sign-in method and compare the investigation time with returned events. Use your organization's approved password-recovery process if appropriate; do not request a password."},
 mfa: {label:'MFA or verification', advice:"Confirm the factor and exact step where sign-in stops. Use your organization's approved MFA recovery process after verifying the user; never request a verification code."},
 identifier: {label:'Email or account identifier', advice:'Check the spelling and sign-in method with the user. A missing profile can also reflect indexing or a different identifier.'},
 redirect: {label:'Redirect or application access', advice:'Ask the application team to review redirect and callback errors around the investigation time. A successful Auth0 event alone does not confirm application access.'},
};

export function reportedIssue(category: unknown): {label: string; advice: string} | undefined {
 return typeof category === 'string' && Object.hasOwn(reportedIssues, category) ? reportedIssues[category as ReportedIssueCategory] : undefined;
}

/** Operator-reported context; it is not evidence and is never sent to the model. */
export interface AccountCaseContext {
 incidentTime: string;
 incidentZone?: string;
 timeSource?: 'event' | 'reported';
 reportedEmail?: string;
 selectedFromMultiple?: boolean;
 selectedFromExactLookup?: boolean;
 sourceLink?: AccountLeadLink;
 sourceEvent?: SourceEvent;
 issueCategory?: ReportedIssueCategory;
 application: string;
 symptom: string;
 ticket: string;
}

export function accountEventLabel(type: string): string {
 const labels: Record<string, string> = {s:'Successful login', f:'Failed login', fp:'Incorrect password', fu:'Invalid email or username', gd_auth_failed:'MFA authentication failed', gd_auth_succeed:'MFA authentication succeeded', gd_auth_rejected:'MFA authentication rejected', gd_otp_rate_limit_exceed:'MFA OTP rate limit reached', limit_wc:'Brute-force protection', limit_sul:'Account rate limited', limit_mu:'IP protection'};
 return Object.hasOwn(labels, type) ? `${labels[type]} (${type})` : `Auth0 event ${type}`;
}

export function recentAccountEvents(result: Investigation): Array<{time: string; type: string; application: string}> {
 const step = result.steps.find(item => item.id === 'logs');
 if (step?.evidence?.status !== 'success' || !['completed', 'warning'].includes(step.state)) return [];
 const events = accountLogEvents(result);
 return events.flatMap(event => {
  if (!event || typeof event !== 'object') return [];
  const row = event as Record<string, unknown>;
  if (typeof row.date !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(row.date) || !Number.isFinite(Date.parse(row.date)) || typeof row.type !== 'string') return [];
  return [{time: new Date(row.date).toISOString(), type: row.type, application: typeof row.client_name === 'string' && row.client_name ? row.client_name : 'Unknown application'}];
 }).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

export function accountHistoryDescription(result: Investigation): string {
 const history = result.accountHistory;
 if (!history) return 'No successful account log page is available.';
 const descriptions = {
  no_incident_time:'No incident time was supplied, so older pages were not requested.',
  short_page:'The last returned page was short.',
  incident_window_reached:'A full page reached at least one hour before the investigation time.',
  page_limit:'The five-page limit was reached; older events may remain.',
  read_failed:`An older page failed: ${history.error?.error ?? 'unknown error'}`,
  shared_failure:'Another account check reported a potentially shared failure, so older page reads stopped.',
  repeated_page:'An older page repeated prior events, so further reads stopped.',
 };
 return `${history.pages.length} page(s) returned. ${descriptions[history.stop]}${history.duplicates ? ` ${history.duplicates} duplicate event(s) excluded.` : ''} Pages can be incomplete due to retention, indexing, concurrent changes, or missing account identifiers.`;
}

/** This comparison describes only the returned page, not coverage of the incident. */
export function nearReportedTime(eventTime: string, incidentTime: string): boolean {
 const event = Date.parse(eventTime), incident = Date.parse(incidentTime);
 return Number.isFinite(event) && Number.isFinite(incident) && Math.abs(event - incident) <= 60 * 60 * 1000;
}

/** Name equality is only a comparison hint; names can change or collide. */
export function matchesReportedApplication(actual: unknown, reported: string): boolean {
 if (typeof actual !== 'string' || !reported.trim() || !actual.trim() || actual.trim().toLowerCase() === 'unknown application') return false;
 return actual.trim().toLowerCase() === reported.trim().toLowerCase();
}

/** MFA failure and success events can coexist; their presence does not link attempts. */
export function mfaEvidenceCaveat(result: Investigation): string | undefined {
 const events = accountLogEvents(result);
 if (!events.some(event => event.type === 'gd_auth_failed')) return;
 const success = events.some(event => event.type === 'gd_auth_succeed');
 return `An MFA failure event does not by itself prove the reported sign-in failed. Auth0 can emit MFA failure and success events while checking multiple OTP enrollments. ${success ? 'An MFA success event was also returned, but these events may be unrelated.' : 'No MFA success event was returned in these pages; one could still be missing.'} Compare the event times and user experience before considering recovery.`;
}

/** Describe observed timestamps without claiming the provider returned a complete interval. */
export function accountTimeComparison(result: Investigation, incidentTime: string): string {
 const events = recentAccountEvents(result);
 if (!events.length) return 'No dated account events with event types are available; the incident time cannot be compared with account history.';
 const newest = events[0].time, oldest = events[events.length - 1].time;
 const range = `${events.length} dated account event(s) returned, from ${oldest} to ${newest} (UTC).`;
 if (!Number.isFinite(Date.parse(incidentTime))) return `${range} No valid incident time was supplied for comparison. The observed range does not establish complete coverage.`;
 const near = events.filter(event => nearReportedTime(event.time,incidentTime)).length;
 return `${range} ${near} returned event(s) are within one hour of the investigation time. The observed range does not establish complete coverage or rule out missing events.`;
}

/** Compare only dated account events near the investigation time with the same nonempty application name. */
export function laterAccountSuccess(result: Investigation, incidentTime: string): {failureTime:string; successTime:string; application:string} | undefined {
 if (!incidentTime) return;
 const events = recentAccountEvents(result).filter(event => nearReportedTime(event.time, incidentTime));
 for (const success of events.filter(event => event.type === 's' && event.application !== 'Unknown application')) {
  const failure = events.find(event => ['f','fp','fu'].includes(event.type) && event.application === success.application && Date.parse(event.time) < Date.parse(success.time));
  if (failure) return {failureTime:failure.time, successTime:success.time, application:success.application};
 }
}

/** Records apply to a submitted identifier, not necessarily to a verified account or login. */
export function identifierProtectionAdvice(evidence?: Evidence): string | undefined {
 if (evidence?.status !== 'success') return;
 return evidence.data?.has_blocks === true
  ? 'Protection records warrant review. Compare them with the reported problem and applicable allowlists before an authorized administrator considers recovery.'
  : 'No protection records were returned for this submitted email. This does not rule out other causes or blocks.';
}

/** Turn submitted-email checks into cautious, human-reviewable next steps. */
export function identifierNextSteps(submittedLogs?: Evidence, identifierBlocks?: Evidence): string[] {
 const steps: string[] = [];
 if (submittedLogs?.status === 'error') steps.push(safeError(submittedLogs.error) === 'MISSING_SCOPE'
  ? 'Ask an Auth0 administrator to verify read:logs permission for the submitted-email search.'
  : 'Review the submitted-email search error before deciding whether to retry.');
 else if (submittedLogs?.status === 'success') {
  const events = submittedLogs.data?.events;
  if (!Array.isArray(events) || typeof submittedLogs.data?.page_full !== 'boolean') steps.push('The submitted-email search response could not be assessed.');
  else if (events.length) steps.push('Compare the returned submitted-email events with the investigation time and application. The email does not establish the actor or a unique account.');
  else steps.push(submittedLogs.data.page_full
   ? 'No matching submitted-email events were returned from a full provider page; more results may exist.'
   : 'No matching submitted-email events were returned on this page; missing events and other causes remain possible.');
  if (typeof submittedLogs.data?.refresh_error === 'string') steps.push('A later submitted-email search failed; earlier results may be stale.');
 }
 if (identifierBlocks?.status === 'error') steps.push(safeError(identifierBlocks.error) === 'MISSING_SCOPE'
  ? 'Ask an Auth0 administrator to verify read:users permission for the submitted-email protection check.'
  : 'Review the submitted-email protection-check error before deciding whether to retry.');
 else if (identifierBlocks?.status === 'success') {
  const advice = identifierProtectionAdvice(identifierBlocks);
  if (typeof identifierBlocks.data?.has_blocks === 'boolean' && advice) steps.push(advice);
  else steps.push('The submitted-email protection response could not be assessed.');
  if (typeof identifierBlocks.data?.refresh_error === 'string') steps.push('A later protection check failed; earlier results may be stale.');
 }
 return steps;
}

/** Combine account findings with optional identifier checks without inferring identity or cause. */
export function accountCaseRecommendation(result: Investigation, submittedLogs?: Evidence, identifierBlocks?: Evidence, skippedChecks: string[] = []) {
 const base = investigationRecommendation(result);
 const events = submittedLogs?.status === 'success' && Array.isArray(submittedLogs.data?.events) ? submittedLogs.data.events : [];
 const failureTypes = new Set(['f','fp','fu','gd_auth_failed','gd_auth_rejected','gd_otp_rate_limit_exceed','limit_wc','limit_sul','limit_mu']);
 const hasSignal = events.some(event => event && typeof event === 'object' && typeof event.type === 'string' && failureTypes.has(event.type))
  || (identifierBlocks?.status === 'success' && identifierBlocks.data?.has_blocks === true);
 const hasGap = submittedLogs?.status === 'error' || identifierBlocks?.status === 'error' || submittedLogs?.data?.refresh_error !== undefined || identifierBlocks?.data?.refresh_error !== undefined
  || (submittedLogs?.status === 'success' && (submittedLogs.data?.page_full === true || submittedLogs.data?.additional_error !== undefined || submittedLogs.data?.repeated_page === true || (typeof submittedLogs.data?.duplicate_count === 'number' && submittedLogs.data.duplicate_count > 0) || (typeof submittedLogs.data?.rejected === 'number' && submittedLogs.data.rejected > 0)))
  || skippedChecks.some(item => item === 'tenant log search' || item === 'protection check');
 if (hasSignal) return {...base, status:'Follow-up needed', reason:`Submitted-email checks returned signals for review; they do not establish the actor, a unique account, or the cause.${hasGap ? ' Some submitted-email evidence is incomplete.' : ''} ${base.reason}`};
 if (hasGap && base.status !== 'Follow-up needed') return {...base,status:'More evidence needed',reason:`Submitted-email checks are incomplete. ${base.reason}`};
 if (hasGap) return {...base,reason:`${base.reason} Submitted-email checks are incomplete.`};
 return base;
}

/** Produce editable customer-facing text without copying account data or inferring a diagnosis. */
export function customerReplyDraft(context: AccountCaseContext, offline: boolean): string {
 const missing = [
  ...(!context.incidentTime || context.timeSource === 'event' ? ['the approximate time and timezone'] : []),
  ...(!context.application.trim() ? ['the application you tried to access'] : []),
  ...(!context.symptom.trim() ? ['the error message you saw'] : []),
 ];
 const details = missing.length > 1 ? `${missing.slice(0,-1).join(', ')} and ${missing[missing.length-1]}` : missing[0];
 const request = missing.length ? `Could you share ${details}?` : 'If the problem is still happening, please let us know if anything has changed since your last attempt.';
 return `${offline ? '[FICTIONAL EXAMPLE — DO NOT SEND]\n\n' : ''}Hi,\n\nThank you for reporting the sign-in problem. We are reviewing the information available.\n\n${request} Please do not send your password or one-time verification codes.\n\nWe will follow up after reviewing the issue.`;
}

/** Plain-text handoff is generated locally from the current case, without AI. */
export function accountCaseSummary(result: Investigation, context: AccountCaseContext, offline: boolean, submittedLogs?: Evidence, identifierBlocks?: Evidence, skippedChecks: string[] = []): string {
 const recommendation = accountCaseRecommendation(result,submittedLogs,identifierBlocks,skippedChecks);
 const observations = findings(result);
 const events = recentAccountEvents(result);
 const lines = [offline ? 'LOGINLENS — FICTIONAL EXAMPLE' : 'LOGINLENS — ACCOUNT INVESTIGATION',
  `Account supplied: ${result.target}`, `Identifier type: ${targetType(result.target, result.targetType) === 'email' ? 'Email' : 'Auth0 user ID'}`, `Investigation started: ${result.started}`,
  ...(context.reportedEmail ? [`Reported email: ${context.reportedEmail} (selected account must match its current profile)`] : []),
  ...(context.selectedFromMultiple ? ['Account selection: manually selected from multiple email matches; selection is not proof of authorization or of who attempted the login.'] : []),
  ...(context.selectedFromExactLookup ? ['Account selection: manually selected from case-sensitive email lookup after indexed search returned no match; selection is not proof of authorization or of who attempted the login.'] : []),
  ...(context.sourceLink ? [`Account selection: manually selected from an event investigation (${accountLeadLabel(context.sourceLink)}); selection does not establish authorization or who attempted the login.`] : []),
  ...(validSourceEvent(context.sourceEvent) ? [`Source event: ${context.sourceEvent!.id} | ${accountEventLabel(context.sourceEvent!.type)} | ${context.sourceEvent!.time} (UTC). This event is a lead, not proof of who attempted sign-in.`] : []),
  `Investigation time: ${context.incidentTime || 'Not provided'}${context.incidentTime ? context.timeSource === 'event' ? ' (selected event time, not customer-reported)' : context.incidentZone ? ` (reported in ${context.incidentZone})` : '' : ''}`, `Reported application: ${context.application || 'Not provided'}`,
  `Reported symptom: ${context.symptom || 'Not provided'}`, `Reported problem category: ${reportedIssue(context.issueCategory)?.label || 'Not specified'} (operator-reported; not confirmed by evidence)`,
  ...(reportedIssue(context.issueCategory) ? [`Suggested review: ${reportedIssue(context.issueCategory)!.advice}`] : []),
  `Jira request supplied: ${context.ticket || 'Not provided'} (not verified)`, '', 'CHECK RESULTS'];
 for (const step of result.steps.filter(item => ['search', 'match', 'profile', 'logs', 'blocks'].includes(item.id))) lines.push(`- ${step.label}: ${step.state} — ${step.summary}`);
 lines.push('', 'OBSERVATIONS');
 lines.push(...(observations.length ? observations.map(item => `- ${item.text} [${item.source}${item.page ? ` page ${item.page}` : ''}]`) : ['- No findings available from completed checks.']));
 lines.push('', 'RETURNED ACCOUNT EVENTS (UTC)', accountHistoryDescription(result), accountTimeComparison(result,context.incidentTime));
 if (context.application.trim()) lines.push('Application-name matches are hints; names can change or be shared and do not prove the event is related.');
 lines.push(...(events.length ? events.map(event => `- ${event.time} | ${accountEventLabel(event.type)} | ${event.application}${nearReportedTime(event.time, context.incidentTime) ? ' | within 1 hour of investigation time' : ''}${matchesReportedApplication(event.application,context.application) ? ' | matches reported application name' : ''}`) : ['- No dated events available in the returned page.']));
 const mfaCaveat = mfaEvidenceCaveat(result);
 if (mfaCaveat) lines.push(`- ${mfaCaveat}`);
 const laterSuccess = laterAccountSuccess(result, context.incidentTime);
 if (laterSuccess) lines.push(`- A successful Auth0 login at ${laterSuccess.successTime} followed a failed login at ${laterSuccess.failureTime}; both reported the application name ${laterSuccess.application} near the investigation time. This does not establish that the events are related or that the customer reached the application.`);
 if (submittedLogs) {
  lines.push('', 'SUBMITTED-EMAIL TENANT LOG SEARCH');
  if (submittedLogs.status === 'error') lines.push(`- Search failed: ${submittedLogs.error ?? 'Unknown error'}`);
  else {
   const data = submittedLogs.data, matched = Array.isArray(data?.events) ? data.events : [];
   lines.push(`- ${submittedEmailWindowDescription(submittedLogs,context.incidentTime) ?? 'Requested tenant-log window unavailable.'}`);
   lines.push(...pageObservationLines(submittedLogs).map(line => `- ${line}`));
   lines.push(`- ${matched.length} matching event(s); provider page ${data?.page_full ? 'full' : 'not full'}; ${Number(data?.rejected ?? 0)} returned row(s) excluded.`);
   if (typeof data?.pages_read === 'number') lines.push(`- ${data.pages_read} page(s) read; ${Number(data.duplicate_count ?? 0)} duplicate event(s) excluded across pages.`);
   if (data?.repeated_page === true) lines.push('- An older page repeated prior events; further reads stopped.');
   if (typeof data?.additional_error === 'string') lines.push(`- An older page failed: ${data.additional_error}. Earlier results remain available.`);
   if (typeof data?.refresh_error === 'string') lines.push(`- A later search failed: ${data.refresh_error}. Earlier results may be stale.`);
   for (const item of matched) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string,unknown>;
    lines.push(`- ${String(row.date ?? 'Unknown time')} | ${accountEventLabel(String(row.type ?? 'unknown'))} | ${typeof row.client_name === 'string' && row.client_name ? row.client_name : 'Unknown application'}${matchesReportedApplication(row.client_name,context.application) ? ' | matches reported application name' : ''}${typeof row.source_page === 'number' ? ` | page ${row.source_page}` : ''}`);
   }
   lines.push('- A submitted email does not establish the actor or a unique account. Retention, indexing, page limits and missing identifiers may hide events.');
  }
 }
 if (identifierBlocks) {
  lines.push('', 'SUBMITTED-EMAIL PROTECTION CHECK');
  if (identifierBlocks.status === 'error') lines.push(`- Check failed: ${identifierBlocks.error ?? 'Unknown error'}`);
  else {
   if (observationTime(identifierBlocks.observedAt)) lines.push(`- Protection response received at ${identifierBlocks.observedAt} (browser clock).`);
   lines.push(`- ${String(identifierBlocks.data?.block_count ?? 'Unknown')} brute-force protection record(s) returned. These records do not establish who attempted login or whether a particular login is effectively blocked.`);
   if (typeof identifierBlocks.data?.refresh_error === 'string') lines.push(`- A later protection check failed: ${identifierBlocks.data.refresh_error}. Earlier results may be stale.`);
   const advice = identifierProtectionAdvice(identifierBlocks);
   if (advice) lines.push(`- ${advice}`);
  }
 }
 const skipped = skippedChecks.filter(item => ['tenant log search','protection check'].includes(item));
 if (skipped.length) lines.push('', 'APPROVED CHECKS NOT RUN', ...skipped.map(item => `- ${item}: review prior errors and incident time before retrying.`));
 const identifierSteps = identifierNextSteps(submittedLogs,identifierBlocks);
 if (identifierSteps.length) lines.push('', 'SUBMITTED-EMAIL NEXT STEPS', ...identifierSteps.map(item => `- ${item}`));
 lines.push('', `ASSESSMENT: ${recommendation.status}`, recommendation.reason, ...recommendation.actions.map(action => `- ${action.text} [${action.source}${'page' in action && action.page ? ` page ${action.page}` : ''}]`), '',
  'Limits: Account log pages do not establish complete incident history. Some failed events may be missing from account history. A successful Auth0 event does not confirm application access. Review the evidence before acting.');
 return lines.join('\n');
}
