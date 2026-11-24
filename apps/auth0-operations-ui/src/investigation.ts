import { invokeRead, type Evidence, type ToolClient } from './operations.ts';
import { safeError } from './investigationErrors.ts';

export type State = 'queued' | 'running' | 'completed' | 'warning' | 'failed' | 'skipped';
export type NodeId = 'search' | 'match' | 'not-found' | 'profile' | 'logs' | 'blocks' | 'aggregate' | 'diagnosis' | 'report';
export interface Step { id: NodeId; label: string; purpose: string; dependencies: NodeId[]; state: State; summary: string; started?: string; ended?: string; evidence?: Evidence; }
export type HistoryStop = 'no_incident_time' | 'short_page' | 'incident_window_reached' | 'page_limit' | 'read_failed' | 'shared_failure' | 'repeated_page';
export interface AccountHistory { pages: Evidence[]; stop: HistoryStop; duplicates: number; error?: Evidence; }
export type TargetType = 'email' | 'user_id';
export interface Investigation { id: string; target: string; targetType?: TargetType; started: string; steps: Step[]; diagnosis?: string; accountHistory?: AccountHistory; }
export interface Finding { category: 'confirmed' | 'inconclusive' | 'not observed'; text: string; source: NodeId; page?: number; }
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'unknown';
export interface StepView { step: Step; execution: ExecutionStatus; severity: 'warning' | 'none'; }
/** Legacy warning means the application completed a check with a diagnostic caveat. */
export function stepView(step: Step): StepView {
 const execution: ExecutionStatus = step.state === 'queued' ? 'pending' : step.state === 'warning' ? 'completed' : ['running','completed','failed','skipped'].includes(step.state) ? step.state as ExecutionStatus : 'unknown';
 return {step, execution, severity: step.state === 'warning' || (step.id === 'profile' && step.evidence?.data?.blocked === true) || (step.id === 'blocks' && step.evidence?.data?.has_blocks === true) ? 'warning' : 'none'};
}
/** Match the Auth0 node's bounded, unquoted ASCII email input contract. */
export function supportedEmail(value: string): boolean {
 if (value.length > 254 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.\-]+@[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?$/.test(value) || value.includes('..') || value.startsWith('.')) return false;
 const [local, domain] = value.split('@');
 return !local.endsWith('.') && domain.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
export function targetType(value: string, selected?: TargetType): TargetType | undefined {
 const target = value.trim();
 if (target.length > 254 || [...target].some(char => char.charCodeAt(0) < 32)) return;
 const email = supportedEmail(target);
 const userId = /^[A-Za-z0-9_-]+\|[^\s|]+$/.test(target);
 if (selected) return selected === 'email' && email || selected === 'user_id' && userId ? selected : undefined;
 if (userId && target.includes('@')) return undefined;
 return email !== userId ? email ? 'email' : 'user_id' : undefined;
}
export function validateTarget(value: string, selected?: TargetType): string | undefined {
 if (targetType(value, selected)) return undefined;
 if (!selected && supportedEmail(value.trim()) && /^[A-Za-z0-9_-]+\|[^\s|]+$/.test(value.trim())) return 'This could be an email or a user ID. Select which kind of identifier it is.';
 if (!selected && value.trim().includes('@') && /^[A-Za-z0-9_-]+\|[^\s|]+$/.test(value.trim())) return 'This looks like a user ID but also contains an unsupported email format. Select user ID only if it is confirmed.';
 return 'Enter a supported unquoted ASCII email address or an Auth0 user ID, such as auth0|123. For other email formats, use a confirmed user ID.';
}
/** Offer candidates only when every returned row matches the requested email and has a distinct usable ID. */
export function accountCandidates(result: Investigation): string[] {
 if (targetType(result.target,result.targetType) !== 'email' || result.steps.find(step => step.id === 'match')?.state !== 'warning') return [];
 const search = result.steps.find(step => step.id === 'search');
 const users = search?.evidence?.data?.users;
 if (search?.state !== 'completed' || search.evidence?.status !== 'success' || !Array.isArray(users) || users.length < 2 || users.length > 20 || search.evidence.data?.count !== users.length) return [];
 const ids: string[] = [];
 for (const user of users) {
  if (!user || typeof user !== 'object' || typeof user.email !== 'string' || user.email.toLowerCase() !== result.target.toLowerCase() || typeof user.user_id !== 'string' || user.user_id !== user.user_id.trim() || validateTarget(user.user_id,'user_id')) return [];
  ids.push(user.user_id);
 }
 return new Set(ids).size === ids.length ? ids : [];
}
/** Return only successfully retrieved pages, deduplicating IDs across pages. */
export function accountLogEvents(result: Investigation): Record<string, unknown>[] {
 const step = result.steps.find(item => item.id === 'logs');
 if (!step || step.state === 'failed' || step.state === 'skipped') return [];
 const pages = result.accountHistory?.pages ?? (step.evidence ? [step.evidence] : []);
 const seen = new Set<string>();
 return pages.flatMap(page => page.status === 'success' && Array.isArray(page.data?.events) ? page.data.events : []).filter((row): row is Record<string, unknown> => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const id = (row as Record<string, unknown>).log_id;
  if (typeof id !== 'string' || !id) return true;
  if (seen.has(id)) return false;
  seen.add(id); return true;
 });
}
/** Return the one-based page containing a type, preserving evidence provenance. */
function eventPage(result: Investigation, types: readonly string[]): number | undefined {
 const step = result.steps.find(item => item.id === 'logs');
 if (!step || step.state === 'failed' || step.state === 'skipped') return undefined;
 const pages = result.accountHistory?.pages ?? (step.evidence ? [step.evidence] : []);
 const seen = new Set<string>();
 for (const [index,page] of pages.entries()) {
  if (page.status !== 'success' || !Array.isArray(page.data?.events)) continue;
  for (const event of page.data.events) {
   if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
   const id = event.log_id;
   if (typeof id === 'string' && id) { if (seen.has(id)) continue; seen.add(id); }
   if (types.includes(String(event.type))) return index + 1;
  }
 }
 return undefined;
}
/** Only derive findings that are directly supported by validated results. */
export function findings(result: Investigation): Finding[] {
 const get = (id: NodeId) => { const step = result.steps.find(item => item.id === id); return step?.state === 'failed' && step.evidence?.status === 'success' ? undefined : step?.evidence; };
 const profile = get('profile'), blocks = get('blocks'), logs = get('logs');
 const events = accountLogEvents(result);
 const items: Finding[] = [];
 const search = get('search');
 if (search?.status === 'success' && search.data?.count === 0) items.push({category:'inconclusive',text:'No matching account was returned; verify the identifier and search indexing.',source:'search'});
 if (profile?.status === 'success') items.push({category: profile.data?.blocked === true ? 'confirmed' : 'not observed', text: profile.data?.blocked === true ? 'The account profile reports an administrative block.' : 'The account profile does not report an administrative block.', source:'profile'});
 if (blocks?.status === 'success') items.push({category: blocks.data?.has_blocks === true ? 'confirmed' : 'not observed', text: blocks.data?.has_blocks === true ? 'Brute-force protection records were returned.' : 'No brute-force block records were returned by this check.', source:'blocks'});
 if (logs?.status === 'success') items.push({category: logs.data?.count === 0 ? 'inconclusive' : 'confirmed', text: logs.data?.count === 0 ? 'No events were returned on this page; the cause is unknown.' : 'Authentication events were returned; inspect their types and timestamps.', source:'logs',page:1});
 if (logs?.status === 'success' && events.some(event => event.type === 'f')) items.push({category:'confirmed',text:'A failed login event was returned; it does not establish the cause.',source:'logs',page:eventPage(result,['f'])});
 for (const [type, label] of [['fp','incorrect-password'], ['fu','unknown-user']] as const) {
  if (logs?.status === 'success' && events.some(event => event.type === type)) items.push({category:'confirmed',text:`A ${type} (${label}) event was returned; inspect its timestamp and context.`,source:'logs',page:eventPage(result,[type])});
 }
 for (const [type, label] of [['gd_auth_failed','MFA authentication failure'], ['gd_auth_rejected','MFA authentication rejection']] as const) {
  if (logs?.status === 'success' && events.some(event => event.type === type)) items.push({category:'confirmed',text:`An ${type} (${label}) event was returned; compare its timestamp and context with the reported issue.`,source:'logs',page:eventPage(result,[type])});
 }
 if (logs?.status === 'success' && events.some(event => event.type === 'gd_otp_rate_limit_exceed')) items.push({category:'confirmed',text:'An MFA OTP rate-limit event was returned; compare its timestamp with the reported issue.',source:'logs',page:eventPage(result,['gd_otp_rate_limit_exceed'])});
 for (const id of ['profile','logs','blocks'] as const) if (result.steps.find(step => step.id === id)?.state === 'failed') items.push({category:'inconclusive',text:'This check failed; its absence cannot rule out a problem.',source:id});
 return items;
}
export function investigationRecommendation(result: Investigation) {
 const step = (id: NodeId) => result.steps.find(item => item.id === id);
 const actions: Array<{source: NodeId; text: string; page?: number}> = [];
 const failedCheckAction = (source: 'search' | 'profile' | 'logs' | 'blocks', evidence?: Evidence) => {
  const category = safeError(evidence?.error);
  if (category === 'MISSING_SCOPE') return `Ask an Auth0 administrator to verify ${source === 'logs' ? 'read:logs_users' : 'read:users'} permission for this check.`;
  if (category === 'RATE_LIMITED') {
   const seconds = evidence?.retryAfterSeconds;
   return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400
    ? `Auth0 reported a rate limit. Wait at least ${seconds} seconds before an authorized retry.`
    : 'Auth0 reported a rate limit. Check the service guidance before an authorized retry.';
  }
  if (category === 'AUTHENTICATION_FAILED') return 'Ask an administrator to check the Auth0 connection credentials and authorization.';
  if (category === 'TIMEOUT') return 'The request timed out and may still be running. Check its status before an authorized retry.';
  if (category === 'AUTH0_UNAVAILABLE') return 'Check Auth0 availability and the connection before an authorized retry.';
  return source === 'logs' ? 'Review the incomplete account-log check and its error before deciding whether to retry.' : 'Review the incomplete check and its error before deciding whether to retry.';
 };
 if (step('search')?.evidence?.error === 'SEARCH_INCOMPLETE') {
  return {
   status: 'More evidence needed',
   reason: 'The email search was truncated, so it cannot identify a unique account.',
   actions: [{source: 'search' as const, text: 'Confirm the exact Auth0 user ID and start a new investigation with it.'}],
  };
 }
 if (step('search')?.evidence?.status === 'success' && step('search')?.evidence?.data?.count === 0) {
  return {
   status: 'More evidence needed',
   reason: 'No matching profile was returned. The account may be missing or not yet indexed.',
   actions: [{source: 'search' as const, text: 'Verify the submitted email and review the submitted-email checks for additional evidence.'}],
  };
 }
 if (step('search')?.evidence?.status === 'error') return {
  status: 'More evidence needed', reason: 'The email search failed, so the account could not be verified.',
  actions: [{source:'search' as const, text:failedCheckAction('search',step('search')?.evidence)}],
 };
 if (step('profile')?.state !== 'completed') {
  return {
   status: 'More evidence needed',
   reason: 'The investigation could not verify the account.',
   actions: [{source: 'profile' as const, text: step('profile')?.evidence?.status === 'error' ? failedCheckAction('profile',step('profile')?.evidence) : 'Confirm the exact Auth0 user ID and start a new investigation with it.'}],
  };
 }
 if (step('profile')?.evidence?.data?.blocked === true) {
  actions.push({source: 'profile', text: 'Ask an authorized administrator to verify why the account was blocked and determine whether it should remain blocked.'});
 }
 if (step('blocks')?.evidence?.data?.has_blocks === true) {
  actions.push({source: 'blocks', text: 'Review the protection records against the time of the reported sign-in issue before considering recovery.'});
 }
 const logs = accountLogEvents(result);
 if (logs.some(event => typeof event.type === 'string' && ['f', 'fp', 'fu'].includes(event.type))) {
  actions.push({source: 'logs', page:eventPage(result,['f','fp','fu']), text: 'Compare the failed sign-in event with the time and error reported by the user.'});
 }
 if (logs.some(event => typeof event.type === 'string' && ['gd_auth_failed', 'gd_auth_rejected'].includes(event.type))) {
  actions.push({source: 'logs', page:eventPage(result,['gd_auth_failed','gd_auth_rejected']), text: 'Compare the MFA event with the investigation time and review the factor and user experience before recommending recovery.'});
 }
 if (logs.some(event => event.type === 'gd_otp_rate_limit_exceed')) actions.push({source:'logs', page:eventPage(result,['gd_otp_rate_limit_exceed']), text:'Compare the MFA OTP rate-limit event with the investigation time and consult current Auth0 guidance before advising another attempt.'});
 const gaps = (['logs', 'blocks'] as const).filter(id => step(id)?.state !== 'completed' || step(id)?.evidence?.status !== 'success');
 if (actions.length && gaps.length) return {
  status: 'Follow-up needed', reason: 'The account checks found signals that warrant review, but some evidence is incomplete.',
  actions: [...actions,...gaps.map(source => ({source,text:failedCheckAction(source,source === 'logs' && result.accountHistory?.error ? result.accountHistory.error : step(source)?.evidence)}))],
 };
 if (actions.length) return {status: 'Follow-up needed', reason: 'The account checks found signals that warrant review.', actions};
 if (gaps.length) return {
  status: 'More evidence needed',
  reason: 'The available checks are incomplete.',
  actions: gaps.map(source => ({source, text: failedCheckAction(source,source === 'logs' && result.accountHistory?.error ? result.accountHistory.error : step(source)?.evidence)})),
 };
 return {status: 'Cause not established', reason: 'The returned account checks did not establish why the user could not sign in. Retrieved log pages may omit relevant events, and authentication can fail outside Auth0.', actions: [{source: 'logs' as const, text: 'Compare the returned events with the investigation time and investigate the application or identity provider if needed.'}]};
}

const definitions: Array<[NodeId, string, string, NodeId[]]> = [
 ['search', 'Search Users', 'Find exact email matches.', []], ['match', 'User Found?', 'Require exactly one matching account.', ['search']],
 ['not-found', 'Account Not Found', 'Report an empty search without claiming the account does not exist.', ['match']],
 ['profile', 'Get User', 'Retrieve the confirmed account profile.', ['match']],
 ['logs', 'Get User Logs', 'Retrieve a page of recent authentication events.', ['profile']],
 ['blocks', 'Get User Blocks', 'Inspect brute-force protection records.', ['profile']],
 ['aggregate', 'Aggregate Evidence', 'Collect verified results and identify gaps.', ['logs', 'blocks']],
 ['diagnosis', 'AI Analysis', 'Request an unverified interpretation of current evidence.', ['aggregate']],
 ['report', 'Investigation Report', 'Assess whether the evidence calls for follow-up.', ['diagnosis']],
];
export function createInvestigation(target: string, type?: TargetType): Investigation { return { id: crypto.randomUUID(), target, ...(type ? {targetType:type} : {}), started: new Date().toISOString(), steps: definitions.map(([id,label,purpose,dependencies]) => ({id,label,purpose,dependencies,state:'queued',summary:'Waiting for dependencies.'})) }; }
// Display only fields explicitly described by the Auth0 node contract, even if a response contains extras.
const fields: Record<string, string[]> = { search_users:['success','users','count'], get_users_by_email:['success','users','count'], get_user:['success','user_id','email','name','email_verified','blocked','last_login','logins_count','connections'], get_user_logs:['success','events','count'], get_user_blocks:['success','has_blocks','block_count','blocks'] };
const nested = new Set(['user_id','email','name','email_verified','log_id','date','type','description','connection','client_name','identifier','strategy']);
function safeValue(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(safeValue);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => nested.has(key)).map(([key,v]) => [key,safeValue(v)]));
 if (typeof value === 'string') return value.replace(/\b(Bearer\s+)[^\s]+/gi, '$1[redacted]').replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
 return value;
}
export function safeEvidence(e: Evidence): Evidence {
 const input = e.input ? Object.fromEntries(Object.entries(e.input).filter(([key]) => ['email','user_id','limit','page'].includes(key)).map(([key,value]) => [key,safeValue(value)])) : undefined;
 if (!e.data) return {...e, input};
 const allowed = fields[e.tool] ?? [];
 return { ...e, input, data: Object.fromEntries(Object.entries(e.data).filter(([k]) => allowed.includes(k)).map(([k,v]) => [k,safeValue(v)])) };
}
export async function executeInvestigation(initial: Investigation, client: ToolClient, token: string, analyze: ((evidence: Evidence[]) => Promise<string>) | undefined, emit: (result: Investigation) => void, options: {incidentTime?: string; expectedEmail?: string} = {}): Promise<Investigation> {
 const validation = validateTarget(initial.target, initial.targetType);
 if (validation) throw new Error(validation);
 if (options.expectedEmail && (targetType(initial.target,initial.targetType) !== 'user_id' || !supportedEmail(options.expectedEmail))) throw new Error('Invalid selected-account context.');
 let current = initial;
 const update = (id: NodeId, patch: Partial<Step>) => { current = {...current, steps:current.steps.map(s => s.id === id ? {...s,...patch} : s)}; emit(current); };
 const now = () => new Date().toISOString();
 const start = (id: NodeId) => update(id,{state:'running',started:now(),summary:'Executing…'});
 const finish = (id: NodeId, state: State, summary: string, evidence?: Evidence) => update(id,{state,summary,evidence,ended:now()});
 const skip = (ids: NodeId[], reason: string) => ids.forEach(id => finish(id,'skipped',reason));
 const read = async (id: NodeId, tool: string, input: Record<string, unknown>) => {
  start(id); let result = safeEvidence(await invokeRead(client, token, tool, input));
  if (id === 'logs' && result.status === 'success' && Number(result.data?.count) > 50) result = {tool, input:result.input, status:'error', error:'Malformed tool response: page exceeds requested limit.'};
  let state: State = result.status === 'error' ? 'failed' : 'completed';
  let summary = result.error ?? 'Tool execution succeeded.';
  if (result.status === 'success' && id === 'logs' && result.data?.count === 0) { state = 'warning'; summary = 'No events returned on this page; evidence is insufficient.'; }
  if (result.status === 'success' && id === 'blocks') summary = result.data?.has_blocks ? 'Block records returned. Review them; no action was taken.' : 'No block records returned by this check.';
  if (result.status === 'success' && id === 'profile' && result.data?.blocked === true) summary = 'The profile reports an administrative block.';
  finish(id,state,summary,result); return result;
 };
 let userId: string;
 let search: Evidence | undefined;
 if (targetType(initial.target, initial.targetType) === 'user_id') {
  skip(['search','match','not-found'],'A user ID was supplied; email search is not needed.');
  userId = initial.target;
 } else {
 search = await read('search','search_users',{email:initial.target});
 if (search.status === 'error') { skip(['match','not-found','profile','logs','blocks','aggregate','diagnosis','report'],'Search failed.'); return current; }
 start('match'); const users = search.data?.users as Array<Record<string, unknown>>;
 if (users.length !== 1 || typeof users[0].user_id !== 'string' || !users[0].user_id || String(users[0].email).toLowerCase() !== initial.target.toLowerCase()) {
  const empty = users.length === 0;
  const mismatch = users.length === 1;
  finish('match','warning',empty ? 'No exact match returned. Search indexing may be delayed.' : mismatch ? 'The returned email did not match the search; verify the response.' : 'Multiple matches returned; identify the account before proceeding.');
  if (empty) { start('not-found'); finish('not-found','warning','No matching account was returned. Verify spelling and indexing.'); } else finish('not-found','skipped',mismatch ? 'Returned email does not match.' : 'Multiple accounts require disambiguation.');
  skip(['profile','logs','blocks','aggregate','diagnosis','report'],empty ? 'No unique account returned.' : mismatch ? 'Returned email does not match.' : 'Multiple accounts require disambiguation.'); return current;
 }
 finish('match','completed','One matching account returned.'); finish('not-found','skipped','A matching account was returned.');
 userId = users[0].user_id as string;
 }
 const input = {user_id: userId};
 const profile = await read('profile','get_user',input);
 if (profile.status === 'error' || profile.data?.user_id !== input.user_id) {
  if (profile.status === 'success') finish('profile','failed','Profile user ID did not match the requested account.', profile);
  skip(['logs','blocks','aggregate','diagnosis','report'],'Account profile could not be verified.'); return current;
 }
 const expectedEmail = search ? initial.target : options.expectedEmail;
 if (expectedEmail && (typeof profile.data?.email !== 'string' || profile.data.email.toLowerCase() !== expectedEmail.toLowerCase())) {
  finish('profile','failed','The profile email is missing or differs from the searched email; verify the account before continuing.', profile);
  skip(['logs','blocks','aggregate','diagnosis','report'],'Account profile could not be verified.'); return current;
 }
 const [logs,blocks] = await Promise.all([read('logs','get_user_logs',{...input, limit:50}), read('blocks','get_user_blocks',input)]);
 const incident = options.incidentTime && /(?:Z|[+-]\d{2}:\d{2})$/i.test(options.incidentTime) ? Date.parse(options.incidentTime) : NaN;
 if (logs.status === 'success') {
  const pages = [logs]; const seen = new Set<string>(); let duplicates = 0; let stop: HistoryStop = 'no_incident_time'; let historyError: Evidence | undefined;
  const addIds = (page: Evidence) => {
   let newIds = 0;
   for (const event of (page.data?.events as Record<string,unknown>[])) {
    if (typeof event.log_id !== 'string' || !event.log_id) { newIds++; continue; }
    if (seen.has(event.log_id)) duplicates++; else { seen.add(event.log_id); newIds++; }
   }
   return newIds;
  };
  addIds(logs);
  for (let page = 0; ; page++) {
   const latest = pages[pages.length - 1];
   const events = latest.data!.events as Record<string,unknown>[];
   if (events.length < 50) { stop = 'short_page'; break; }
   if (!Number.isFinite(incident)) { stop = 'no_incident_time'; break; }
   const times = events.map(event => typeof event.date === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(event.date) ? Date.parse(event.date) : NaN);
   if (times.every(Number.isFinite) && times.every((time, i) => i === 0 || times[i - 1] >= time) && times[times.length - 1] <= incident - 3600000) { stop = 'incident_window_reached'; break; }
   // A missing permission or unavailable feature for block records does not
   // establish that the independently scoped user-log endpoint will fail.
   // Unknown and potentially shared failures still stop further reads.
   if (blocks.status === 'error' && !['MISSING_SCOPE','FEATURE_UNAVAILABLE'].includes(safeError(blocks.error) ?? '')) { stop = 'shared_failure'; break; }
   if (page >= 4) { stop = 'page_limit'; break; }
   update('logs',{summary:`Read ${pages.length} full page(s); checking older account events…`});
   let next = safeEvidence(await invokeRead(client, token, 'get_user_logs', {...input, limit:50, page:page + 1}));
   if (next.status === 'success' && Number(next.data?.count) > 50) next = {tool:'get_user_logs', input:next.input, status:'error', error:'Malformed tool response: page exceeds requested limit.'};
   if (next.status === 'error') { historyError = next; stop = 'read_failed'; break; }
   pages.push(next);
   if (!addIds(next) && Number(next.data?.count) > 0) { stop = 'repeated_page'; break; }
  }
  current = {...current, accountHistory:{pages, stop, duplicates, ...(historyError ? {error:historyError} : {})}}; emit(current);
  if (pages.length > 1 || ['read_failed','shared_failure','repeated_page','page_limit'].includes(stop)) {
   const warning = ['read_failed','shared_failure','repeated_page','page_limit'].includes(stop);
   finish('logs', warning ? 'warning' : 'completed', `${pages.length} account log page(s) returned${duplicates ? `; ${duplicates} duplicate event(s) excluded` : ''}. ${stop === 'read_failed' ? `An older page failed: ${historyError?.error ?? 'unknown error'}` : stop === 'shared_failure' ? 'Other account check failed; older reads stopped.' : stop === 'repeated_page' ? 'An older page repeated prior events; further reads stopped.' : stop === 'page_limit' ? 'Page limit reached; older events may remain.' : 'Results are bounded and may omit events.'}`, logs);
  }
 }
 start('aggregate'); const evidence = [search, profile, ...(current.accountHistory?.pages ?? [logs]), blocks].filter((item): item is Evidence => item !== undefined);
 const partial = evidence.some(e => e.status === 'error') || logs.data?.count === 0 || ['read_failed','shared_failure','repeated_page','page_limit'].includes(current.accountHistory?.stop ?? '');
 finish('aggregate',partial ? 'warning' : 'completed',partial ? 'Evidence has gaps; review the individual checks.' : 'Current tool results collected.');
 if (analyze) {
  start('diagnosis');
  try { const diagnosis = await analyze(evidence); current = {...current, diagnosis}; finish('diagnosis','completed','AI analysis received; verify every claim against the evidence.'); }
  catch { finish('diagnosis','failed','AI analysis failed. Check the model and engine configuration.'); }
 } else finish('diagnosis','skipped','AI analysis was not requested.');
 start('report');
 const recommendation = investigationRecommendation(current);
 finish('report',partial || (analyze !== undefined && !current.diagnosis) ? 'warning' : 'completed', recommendation.status);
 return current;
}
