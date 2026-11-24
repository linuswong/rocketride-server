import { invokeRead, type Evidence, type ToolClient } from './operations.ts';
import type { Event } from './loginLensAnalytics.ts';
import { errorCounts, safeError } from './investigationErrors.ts';

// Limits bound requests and preserve partial results for unusually large source groups.
const MAX_SELECTED = 50;
const MAX_ACCOUNTS = 20;
const MAX_RECENT_PER_ACCOUNT = 20;
const MAX_RECENT_DETAILS = 400;
const MAX_APPLICATION_CONFIGS = 5;
const CONCURRENCY = 4;
const failures = new Set(['f', 'fp', 'fu']);
const typeFor: Record<string, string> = { 'Failed login': 'f', 'Wrong password': 'fp', 'Unknown user': 'fu' };
const stopPriority=['RATE_LIMITED','AUTHENTICATION_FAILED','TIMEOUT','AUTH0_UNAVAILABLE','MISSING_SCOPE'];
const stopFor=(responses:Evidence[])=>stopPriority.find(code=>responses.some(response=>safeError(response.error)===code));
export function retryableRateDelay(responses:Evidence[]):number | undefined {
 const limited=responses.filter(response=>safeError(response.error)==='RATE_LIMITED');
 if (!limited.length || responses.some(response=>['AUTH0_UNAVAILABLE','TIMEOUT','MISSING_SCOPE','AUTHENTICATION_FAILED'].includes(safeError(response.error) ?? '')) || limited.some(response=>response.retryable!==true || typeof response.retryAfterSeconds!=='number' || !Number.isFinite(response.retryAfterSeconds) || response.retryAfterSeconds<0 || response.retryAfterSeconds>30)) return;
 return Math.max(...limited.map(response=>response.retryAfterSeconds!));
}
export async function waitForRetry(seconds:number,active:()=>boolean):Promise<boolean> {
 const deadline=performance.now()+seconds*1000;
 while (active() && performance.now()<deadline) await new Promise(resolve=>setTimeout(resolve,Math.min(250,deadline-performance.now())));
 return active();
}
const retryAfterFor=(responses:Evidence[])=>{
 const limited=responses.filter(response=>safeError(response.error)==='RATE_LIMITED');
 return limited.length && limited.every(response=>typeof response.retryAfterSeconds==='number' && response.retryAfterSeconds<=86400) ? Math.max(...limited.map(response=>response.retryAfterSeconds!)) : undefined;
};

export type SourceAccount = {
 userId: string; selectedFailures: number; directFailures: number; emailHintFailures: number; recentFailures: number; sameSourceRecentFailures: number;
 successAfterSelected: 'verified' | 'not_seen' | 'unverified' | 'not_checked';
 successAfterSelectedSameSource: boolean | null;
 successAfterSelectedSameApplication: boolean | null;
 reportedApplications: Array<{name:string;count:number}>;
 reportedApplicationIds: Array<{id:string;count:number}>;
 directFailureTypes: {failedLogin:number; wrongPassword:number; unknownUser:number};
 profile: 'verified' | 'failed' | 'mismatch'; blocked: boolean | null; bruteForceBlocked: boolean | null;
 logs: 'retrieved' | 'failed' | 'skipped'; logsPageFull: boolean; logsEmpty: boolean; invalidRecentEvents: number; recentDetails: number; recentDetailsFailed: number; recentDetailsUnchecked:number;
 profileError?: string; logsError?: string; blocksError?: string;
 verifiedRecentEventIds: string[];
};
export type SourceInvestigation = {
 selected: number; checked: number; matched: number; missingIdentity: number; emailHintResolved: number; failedEvents: number; eventErrors: Record<string,number>; eventRetries:number; eventRetryResponsesSucceeded:number; eventRateRetries:number; eventStopReason?:string; eventRetryAfterSeconds?:number;
 ja3Reported:number; ja3Groups:number; ja3LargestGroup:number; ja4FieldReturned:number; ja4Reported:number; ja4Groups:number; ja4LargestGroup:number; fingerprintFallbacks:number;
 reportedApplications:Array<{name:string;count:number}>; missingApplication:number; reportedApplicationIds:Array<{id:string;count:number}>; missingApplicationId:number; applicationFallbacks:number;
 applicationConfigs:Array<{id:string;status:'verified'|'unavailable';error?:string;appType?:string | null;authMethod?:string | null;authorizationCode?:boolean | null;password?:boolean | null;refreshToken?:boolean | null;clientCredentials?:boolean | null}>;
 applicationConfigUnchecked:number; applicationConfigStopReason?:string;
 unusableIdentifiers: number; ambiguousHints: number; unmatchedHints: number; hintLookupFailures: number; hintLookupError?: string;
 unresolvedIdentifiers: Array<{identifier: string; count: number; reason: string}>;
 verifiedEventIds: string[];
 differentSource: number; unchecked: number; uncheckedAccounts: number; accounts: SourceAccount[];
 accountStopReason?:string; accountRetryAfterSeconds?:number;
 detailBudgetReached: boolean; detailStopReason?:string; detailRateRetries:number; detailRetryAfterSeconds?:number;
};
export type AccountHistoryPage = {page:number; returned:number; failures:number; verified:number; matchingSource:number; duplicates:number; unavailable:number; unchecked:number; pageFull:boolean; verifiedEventIds:string[]; stopReason?:string; retryAfterSeconds?:number; rateRetries:number};
export class AccountHistoryReadError extends Error {
 retryAfterSeconds?:number;
 constructor(message:string, retryAfterSeconds?:number) { super(message); this.retryAfterSeconds=retryAfterSeconds; }
}

/** Distinguish direct event links from submitted-email candidates and unverified profiles. */
export function accountRepetition(account:SourceAccount): 'verified' | 'candidate' | 'unverified' | 'none' {
 if (account.profile!=='verified') return account.selectedFailures>1 ? 'unverified' : 'none';
 if (account.directFailures>1 || account.sameSourceRecentFailures>1) return 'verified';
 return account.selectedFailures>1 ? 'candidate' : 'none';
}

async function pool<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
 const result = new Array<R>(items.length); let next = 0;
 await Promise.all(Array.from({length: Math.min(CONCURRENCY, items.length)}, async () => {
  while (next < items.length) { const index = next++; result[index] = await run(items[index]); }
 }));
 return result;
}

function validIdentity(value: unknown): value is string {
 return typeof value === 'string' && value.trim().length > 0 && value.length <= 300 && value !== '.' && value !== '..';
}
function emailHint(value: unknown): value is string {
 return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value) && !value.includes('..') && !value.startsWith('.') && !value.split('@')[0].endsWith('.');
}
function usableSubmittedName(value: unknown): value is string {
 return typeof value === 'string' && value.length > 0 && value.length <= 254 && /^[\x20-\x7e]+$/.test(value) && !/\b(?:bearer\s+\S+|(?:password|secret|token|api[_ -]?key)\s*[:=]\s*\S+)/i.test(value);
}

/** Follow evidence-bound account IDs through profile, blocks, logs, then recent source checks. */
export async function investigateSourceAccounts(events: Event[], sourceIp: string, client: ToolClient, token: string, progress: (message: string) => void, active = () => true, timeout = 30000): Promise<SourceInvestigation> {
 const chosen = events.slice(0, MAX_SELECTED);
 const read = (tool: string, input: Record<string, unknown>) => active() ? invokeRead(client, token, tool, input, timeout) : Promise.resolve({tool, status:'error'} as Evidence);
 progress(`Resolving accounts for ${chosen.length} selected source events…`);
 const details:Evidence[]=[];
 let eventRetries=0,eventRetryResponsesSucceeded=0,eventRateRetries=0,eventStopReason:string | undefined,eventRetryAfterSeconds:number | undefined,eventRateRetryUsed=false,fingerprintEnabled=true,fingerprintFallbacks=0,applicationEnabled=true,applicationFallbacks=0;
 const selectedInput=(event:Event)=>({log_id:event.id,include_source:true,include_identity_hint:true,...(fingerprintEnabled ? {include_fingerprint:true} : {}),...(applicationEnabled ? {include_application:true} : {})});
 for (let offset=0;offset<chosen.length && active();offset+=CONCURRENCY) {
  const batch=chosen.slice(offset,offset+CONCURRENCY);
  const applicationRequested=applicationEnabled;
  const responses=await pool(batch,event=>read('get_log_event',selectedInput(event)));
  let unsupported=responses.flatMap((response,index)=>response.error==='INVALID_INPUT' ? [index] : []);
  if (applicationEnabled && unsupported.length && !stopFor(responses) && active()) {
   progress('Checking whether application IDs are supported…');
   const retries=await pool(unsupported,index=>read('get_log_event',{log_id:batch[index].id,include_source:true,include_identity_hint:true,...(fingerprintEnabled ? {include_fingerprint:true} : {})}));
   const recovered=retries.filter(response=>response.status==='success').length;
   if (recovered) applicationEnabled=false;
   applicationFallbacks+=recovered;retries.forEach((response,index)=>{responses[unsupported[index]]=response;});
   unsupported=responses.flatMap((response,index)=>response.error==='INVALID_INPUT' ? [index] : []);
  }
  if (fingerprintEnabled && unsupported.length && !stopFor(responses) && active()) {
   progress('Checking whether the fingerprint option is supported…');
   const retries=await pool(unsupported,index=>read('get_log_event',{log_id:batch[index].id,include_source:true,include_identity_hint:true}));
   const recovered=retries.filter(response=>response.status==='success').length;
   if (recovered) {fingerprintEnabled=false;applicationEnabled=false;if (applicationRequested) applicationFallbacks+=recovered;}
   fingerprintFallbacks+=recovered;retries.forEach((response,index)=>{responses[unsupported[index]]=response;});
  }
  const unavailable=responses.flatMap((response,index)=>safeError(response.error)==='AUTH0_UNAVAILABLE' ? [index] : []);
  const conflictingStop=responses.some(response=>['RATE_LIMITED','TIMEOUT','AUTHENTICATION_FAILED','MISSING_SCOPE'].includes(safeError(response.error) ?? ''));
  if (unavailable.length && !conflictingStop && active()) {
   progress(`Retrying ${unavailable.length} temporarily unavailable event read(s)…`);
   const retries=await pool(unavailable,index=>read('get_log_event',selectedInput(batch[index])));
   eventRetries+=retries.length;eventRetryResponsesSucceeded+=retries.filter(response=>response.status==='success').length;
   retries.forEach((response,index)=>{responses[unavailable[index]]=response;});
  }
  const limited=responses.flatMap((response,index)=>safeError(response.error)==='RATE_LIMITED' ? [index] : []);
  const delay=eventRateRetryUsed ? undefined : retryableRateDelay(responses);
  if (delay!==undefined && active()) {
   eventRateRetryUsed=true;
   progress(`Auth0 rate limit: waiting ${delay} second(s) before retrying ${limited.length} selected event read(s)…`);
   if (await waitForRetry(delay,active)) {
    const retries=await pool(limited,index=>read('get_log_event',selectedInput(batch[index])));
    eventRateRetries+=retries.length;retries.forEach((response,index)=>{responses[limited[index]]=response;});
   }
  }
  details.push(...responses);
  const stop=stopFor(responses);
  if (stop) {eventStopReason=stop;if(stop==='RATE_LIMITED') eventRetryAfterSeconds=retryAfterFor(responses);break;}
 }
 if (!active() && details.length<chosen.length) eventStopReason='CANCELLED';
 const grouped = new Map<string, {direct:number; latestDirect:number; latestDirectApplicationId:string | null; hints:number; emails:Set<string>; applications:Map<string,number>; applicationIds:Map<string,number>; directFailureTypes:SourceAccount['directFailureTypes']}>();
 const emptyBinding=()=>({direct:0,latestDirect:0,latestDirectApplicationId:null as string | null,hints:0,emails:new Set<string>(),applications:new Map<string,number>(),applicationIds:new Map<string,number>(),directFailureTypes:{failedLogin:0,wrongPassword:0,unknownUser:0}});
 const hints = new Map<string, number>();
 const unresolvedIdentifiers = new Map<string, {count:number; reason:string}>();
 const verifiedEventIds: string[] = [];
 const fingerprints=new Map<string,number>(), ja4Fingerprints=new Map<string,number>(), applications=new Map<string,number>(), applicationIds=new Map<string,number>(); let ja4FieldReturned=0,missingApplication=0,missingApplicationId=0;
 const unresolved = (identifier: string, count: number, reason: string) => {
  const current = unresolvedIdentifiers.get(identifier);
  unresolvedIdentifiers.set(identifier, {count:(current?.count ?? 0) + count, reason});
 };
 let missingIdentity = 0, unusableIdentifiers = 0, ambiguousHints = 0, unmatchedHints = 0, hintLookupFailures = 0, hintLookupError: string | undefined, failedEvents = 0, differentSource = 0, matched = 0;
 details.forEach((response, index) => {
  const event = chosen[index], data = response.data;
  if (response.status !== 'success' || !data || data.log_id !== event.id || data.type !== typeFor[event.category] || typeof data.date !== 'string' || Date.parse(data.date) !== event.time || typeof data.source_ip !== 'string') { failedEvents++; return; }
  if (data.source_ip !== sourceIp) { differentSource++; return; }
  matched++;
  verifiedEventIds.push(event.id);
  const application=typeof data.client_name==='string' && data.client_name.trim() && data.client_name.length<=300 && !/[\x00-\x1f\x7f]/.test(data.client_name) ? data.client_name.trim() : undefined;
  if (application) applications.set(application,(applications.get(application) ?? 0)+1); else missingApplication++;
  const applicationId=typeof data.client_id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.client_id) ? data.client_id : undefined;
  if (applicationId) applicationIds.set(applicationId,(applicationIds.get(applicationId) ?? 0)+1); else missingApplicationId++;
  if (Object.prototype.hasOwnProperty.call(data,'ja4')) ja4FieldReturned++;
  if (typeof data.ja3==='string' && /^[a-f0-9]{32}$/.test(data.ja3)) fingerprints.set(data.ja3,(fingerprints.get(data.ja3) ?? 0)+1);
  if (typeof data.ja4==='string' && /^[tqd][a-z0-9]{2}[di][0-9]{4}[a-z0-9]{2}_[a-f0-9]{12}_[a-f0-9]{12}$/.test(data.ja4)) ja4Fingerprints.set(data.ja4,(ja4Fingerprints.get(data.ja4) ?? 0)+1);
  if (!validIdentity(data.user_id)) {
   if (emailHint(data.user_name)) { const email = data.user_name.toLowerCase(); hints.set(email, (hints.get(email) ?? 0) + 1); }
   else { missingIdentity++; unusableIdentifiers++; if (usableSubmittedName(data.user_name)) unresolved(data.user_name,1,'Username is not an email; no exact account lookup is available.'); }
   return;
  }
  const entry = grouped.get(data.user_id) ?? emptyBinding();
  if (entry.direct===0 || event.time>entry.latestDirect) {entry.latestDirect=event.time;entry.latestDirectApplicationId=applicationId ?? null;}
  else if (event.time===entry.latestDirect && entry.latestDirectApplicationId!==(applicationId ?? null)) entry.latestDirectApplicationId=null;
  entry.direct++;
  if (application) entry.applications.set(application,(entry.applications.get(application) ?? 0)+1);
  if (applicationId) entry.applicationIds.set(applicationId,(entry.applicationIds.get(applicationId) ?? 0)+1);
  if (data.type==='f') entry.directFailureTypes.failedLogin++;
  else if (data.type==='fp') entry.directFailureTypes.wrongPassword++;
  else if (data.type==='fu') entry.directFailureTypes.unknownUser++;
  grouped.set(data.user_id, entry);
 });
 progress(`Resolving ${hints.size} email-shaped login identifier(s) without an account ID…`);
 const hintEntries = [...hints.entries()];
 const sharedStop=eventStopReason && ['RATE_LIMITED','AUTH0_UNAVAILABLE','TIMEOUT','AUTHENTICATION_FAILED'].includes(eventStopReason) ? eventStopReason : undefined;
 let accountStopReason:string | undefined=sharedStop, accountRetryAfterSeconds:number | undefined=eventRetryAfterSeconds;
 let rateIntervalUnknown=sharedStop==='RATE_LIMITED' && eventRetryAfterSeconds===undefined;
 const readAccount=async (tool:string,input:Record<string,unknown>):Promise<Evidence>=>{
  if (accountStopReason) return {tool,status:'error',error:accountStopReason};
  const response=await read(tool,input), error=safeError(response.error);
  if (error && ['RATE_LIMITED','AUTH0_UNAVAILABLE','TIMEOUT','AUTHENTICATION_FAILED'].includes(error)) {
   accountStopReason=accountStopReason ?? error;
   if (error==='RATE_LIMITED') {
    if (response.retryAfterSeconds===undefined || response.retryAfterSeconds>86400) rateIntervalUnknown=true;
    else accountRetryAfterSeconds=Math.max(accountRetryAfterSeconds ?? 0,response.retryAfterSeconds);
   }
  }
  return response;
 };
 const lookups = await pool(hintEntries, ([email]) => readAccount('search_users', {email,limit:2}));
 let emailHintResolved = 0;
 lookups.forEach((result,index) => {
  const [email,count] = hintEntries[index];
  const users = result.status === 'success' && Array.isArray(result.data?.users) ? result.data.users : [];
  const user = users[0];
  if (result.status !== 'success') { missingIdentity += count; hintLookupFailures += count; hintLookupError ??= result.error; unresolved(email,count,'Email lookup failed.'); return; }
  if (users.length !== 1 || !validIdentity(user?.user_id) || typeof user?.email !== 'string' || user.email.toLowerCase() !== email) { missingIdentity += count; if (users.length > 1) ambiguousHints += count; else unmatchedHints += count; unresolved(email,count,users.length > 1 ? 'Multiple matching accounts.' : 'No unique matching account.'); return; }
  const entry = grouped.get(user.user_id) ?? emptyBinding();
  entry.hints += count; entry.emails.add(email); grouped.set(user.user_id,entry); emailHintResolved += count;
 });
 const entries = [...grouped.entries()].sort((a,b) => (b[1].direct+b[1].hints) - (a[1].direct+a[1].hints));
 progress(sharedStop ? `Account reads stopped after ${sharedStop}; retaining the verified event evidence.` : `Checking profiles, blocks and recent logs for ${Math.min(entries.length, MAX_ACCOUNTS)} accounts…`);
 const accountResults = await pool(entries.slice(0, MAX_ACCOUNTS), async ([userId, binding]) => {
  const account: SourceAccount = {userId, selectedFailures:binding.direct+binding.hints, directFailures:binding.direct, directFailureTypes:binding.directFailureTypes, emailHintFailures:binding.hints, reportedApplications:[...binding.applications].map(([name,count])=>({name,count})), reportedApplicationIds:[...binding.applicationIds].map(([id,count])=>({id,count})), recentFailures:0, sameSourceRecentFailures:0, successAfterSelected:'not_checked', successAfterSelectedSameSource:null, successAfterSelectedSameApplication:null, profile:'failed', blocked:null, bruteForceBlocked:null, logs:'skipped', logsPageFull:false, logsEmpty:false, invalidRecentEvents:0, recentDetails:0, recentDetailsFailed:0,recentDetailsUnchecked:0,verifiedRecentEventIds:[]};
  if (sharedStop) {account.profileError=sharedStop;return {account,recent:[] as Record<string,unknown>[]};}
  const profile = await readAccount('get_user', {user_id:userId});
  if (profile.status !== 'success') { account.profileError = profile.error ?? 'Profile request failed.'; return {account, recent:[] as Record<string, unknown>[]}; }
  if (profile.data?.user_id !== userId || (binding.emails.size > 0 && (typeof profile.data.email !== 'string' || !binding.emails.has(profile.data.email.toLowerCase())))) { account.profile = 'mismatch'; return {account, recent:[] as Record<string, unknown>[]}; }
  account.profile = 'verified'; account.blocked = profile.data.blocked as boolean;
  const [logs, blocks] = await Promise.all([readAccount('get_user_logs', {user_id:userId,limit:MAX_RECENT_PER_ACCOUNT}), readAccount('get_user_blocks', {user_id:userId})]);
  if (blocks.status === 'success') account.bruteForceBlocked = blocks.data?.has_blocks as boolean;
  else account.blocksError = blocks.error ?? 'Block lookup failed.';
  account.logs = logs.status === 'success' ? 'retrieved' : 'failed';
  if (logs.status !== 'success') account.logsError = logs.error ?? 'Recent logs unavailable.';
  const returned = logs.status === 'success' && Array.isArray(logs.data?.events) ? logs.data.events : [];
  account.logsPageFull = returned.length === MAX_RECENT_PER_ACCOUNT;
  account.logsEmpty = logs.status === 'success' && returned.length === 0;
  if (account.logs==='retrieved' && binding.direct>0) {
   const later=returned.filter((row:Record<string,unknown>)=>row.type==='s' && validIdentity(row.log_id) && typeof row.date==='string' && Number.isFinite(Date.parse(row.date)) && Date.parse(row.date)>binding.latestDirect).sort((a:Record<string,unknown>,b:Record<string,unknown>)=>Date.parse(String(b.date))-Date.parse(String(a.date)));
   account.successAfterSelected=later.length ? 'unverified' : 'not_seen';
   const checkedSuccessIds=new Set<string>();
   for (const candidate of later) {
    if (checkedSuccessIds.size>=3 || accountStopReason || !active()) break;
    if (checkedSuccessIds.has(String(candidate.log_id))) continue;
    checkedSuccessIds.add(String(candidate.log_id));
    let detail=await readAccount('get_log_event',{log_id:candidate.log_id,include_source:true,...(applicationEnabled ? {include_application:true} : {})});
    if (detail.error==='INVALID_INPUT' && applicationEnabled && !accountStopReason && active()) detail=await readAccount('get_log_event',{log_id:candidate.log_id,include_source:true});
    if (detail.status==='success' && detail.data?.log_id===candidate.log_id && detail.data?.user_id===userId && detail.data?.type==='s' && typeof detail.data?.date==='string' && Date.parse(detail.data.date)===Date.parse(String(candidate.date))) {
     account.successAfterSelected='verified';
     account.successAfterSelectedSameSource=typeof detail.data.source_ip==='string' && detail.data.source_ip.length>0 ? detail.data.source_ip===sourceIp : null;
     const successApplicationId=typeof detail.data.client_id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(detail.data.client_id) ? detail.data.client_id : undefined;
     account.successAfterSelectedSameApplication=binding.latestDirectApplicationId && successApplicationId ? binding.latestDirectApplicationId===successApplicationId : null;
     break;
    }
   }
  }
  const failureRows = returned.filter((row: Record<string, unknown>) => failures.has(String(row.type)));
  const seen = new Set<string>();
  const recent = failureRows.filter((row: Record<string, unknown>) => {
   if (!validIdentity(row.log_id) || typeof row.date !== 'string' || !Number.isFinite(Date.parse(row.date)) || seen.has(row.log_id)) return false;
   seen.add(row.log_id); return true;
  });
  account.invalidRecentEvents = failureRows.length - recent.length;
  account.recentFailures = recent.length;
  return {account, recent};
 });
 // The user log endpoint is one page; inspect only returned failures and verify their identity and source again.
 const candidates = accountResults.flatMap(({account,recent}) => recent.map(row => ({account,row})));
 const targets = candidates.slice(0, MAX_RECENT_DETAILS);
 progress(`Checking source repetition across ${targets.length} recent failed events…`);
 for (const {account} of candidates) account.recentDetailsUnchecked++;
 let attempted=0, detailStopReason:string | undefined, detailRetryAfterSeconds:number | undefined, detailRateRetries=0, rateRetryUsed=false;
 for (let offset=0;offset<targets.length && active() && !accountStopReason;offset+=CONCURRENCY) {
  const batch=targets.slice(offset,offset+CONCURRENCY);
  const responses=await pool(batch,target=>read('get_log_event',{log_id:target.row.log_id,include_source:true}));
  const limited=responses.flatMap((response,index)=>safeError(response.error)==='RATE_LIMITED' ? [index] : []);
  const delay=rateRetryUsed ? undefined : retryableRateDelay(responses);
  if (delay!==undefined && active()) {
   rateRetryUsed=true;
   progress(`Auth0 rate limit: waiting ${delay} second(s) before retrying ${limited.length} read(s)…`);
   if (await waitForRetry(delay,active)) {
    const retries=await pool(limited,index=>read('get_log_event',{log_id:batch[index].row.log_id,include_source:true}));
    detailRateRetries+=retries.length;
    retries.forEach((response,index)=>{responses[limited[index]]=response;});
   }
  }
  responses.forEach((response,index)=>{
   const {account,row}=batch[index], data=response.data;
   attempted++; account.recentDetailsUnchecked--;
   if (response.status!=='success' || !data || data.log_id!==row.log_id || data.user_id!==account.userId || data.type!==row.type || typeof data.date!=='string' || Date.parse(data.date)!==Date.parse(String(row.date)) || typeof data.source_ip!=='string') {account.recentDetailsFailed++;return;}
   account.recentDetails++; account.verifiedRecentEventIds.push(String(row.log_id));
   if (data.source_ip===sourceIp) account.sameSourceRecentFailures++;
  });
  const stop=stopFor(responses);
  if (stop) {detailStopReason=stop;if(stop==='RATE_LIMITED') detailRetryAfterSeconds=retryAfterFor(responses);break;}
  if (attempted<targets.length && attempted%20===0) progress(`Checked ${attempted} of ${targets.length} recent failed events…`);
 }
 if (!active() && attempted<targets.length) detailStopReason='CANCELLED';
 const rankedApplications=[...applicationIds].sort((a,b)=>b[1]-a[1]);
 const applicationConfigs:SourceInvestigation['applicationConfigs']=[];
 let applicationConfigStopReason=accountStopReason ?? detailStopReason;
 for (const [id] of rankedApplications.slice(0,MAX_APPLICATION_CONFIGS)) {
  if (applicationConfigStopReason || !active()) break;
  const response=await readAccount('get_application_config',{client_id:id});
  if (response.status==='success' && response.data?.client_id===id) {
   const data=response.data;
   applicationConfigs.push({id,status:'verified',appType:data.app_type as string | null,authMethod:data.token_endpoint_auth_method as string | null,authorizationCode:data.authorization_code_enabled as boolean | null,password:data.password_enabled as boolean | null,refreshToken:data.refresh_token_enabled as boolean | null,clientCredentials:data.client_credentials_enabled as boolean | null});
  } else {
   const error=response.error==='INVALID_INPUT' ? 'FEATURE_UNAVAILABLE' : safeError(response.error) ?? 'API_ERROR';
   applicationConfigs.push({id,status:'unavailable',error});
   if (['MISSING_SCOPE','FEATURE_UNAVAILABLE','RATE_LIMITED','AUTHENTICATION_FAILED','TIMEOUT','AUTH0_UNAVAILABLE'].includes(error)) applicationConfigStopReason=error;
  }
 }
 return {selected:events.length, checked:details.length, matched, reportedApplications:[...applications].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count), missingApplication, reportedApplicationIds:rankedApplications.map(([id,count])=>({id,count})), missingApplicationId, applicationFallbacks, applicationConfigs, applicationConfigUnchecked:Math.max(0,rankedApplications.length-applicationConfigs.length),applicationConfigStopReason, ja3Reported:[...fingerprints.values()].reduce((sum,count)=>sum+count,0), ja3Groups:fingerprints.size, ja3LargestGroup:Math.max(0,...fingerprints.values()), ja4FieldReturned, ja4Reported:[...ja4Fingerprints.values()].reduce((sum,count)=>sum+count,0), ja4Groups:ja4Fingerprints.size, ja4LargestGroup:Math.max(0,...ja4Fingerprints.values()), fingerprintFallbacks, missingIdentity, emailHintResolved, unusableIdentifiers, ambiguousHints, unmatchedHints, hintLookupFailures, hintLookupError, unresolvedIdentifiers:[...unresolvedIdentifiers].map(([identifier,value])=>({identifier,...value})), verifiedEventIds, failedEvents, eventErrors:errorCounts(details.filter(response=>response.status==='error').map(response=>response.error)), eventRetries, eventRetryResponsesSucceeded, eventRateRetries, eventStopReason, eventRetryAfterSeconds, differentSource,
  unchecked:events.length-details.length, uncheckedAccounts:Math.max(0, entries.length-MAX_ACCOUNTS), accounts:accountResults.map(item=>item.account), accountStopReason, accountRetryAfterSeconds:rateIntervalUnknown ? undefined : accountRetryAfterSeconds, detailBudgetReached:candidates.length>attempted, detailStopReason, detailRateRetries, detailRetryAfterSeconds};
}

/** Follow one bounded older page for an already verified account; deduplicate against earlier evidence. */
export async function investigateAccountHistoryPage(account:SourceAccount, sourceIp:string, page:number, previousIds:string[], client:ToolClient, token:string, active=()=>true, timeout=30000):Promise<AccountHistoryPage> {
 if (account.profile!=='verified' || !Number.isInteger(page) || page<1 || page>4 || !active()) throw new Error('Account follow-up is unavailable.');
 const readPage=()=>invokeRead(client,token,'get_user_logs',{user_id:account.userId,limit:MAX_RECENT_PER_ACCOUNT,page},timeout);
 let response=await readPage();
 const pageDelay=retryableRateDelay([response]);
 if (pageDelay!==undefined && await waitForRetry(pageDelay,active)) response=await readPage();
 if (response.status!=='success' || !Array.isArray(response.data?.events)) throw new AccountHistoryReadError(response.error ?? 'Account log page unavailable.',response.retryAfterSeconds);
 const rows=response.data.events as Record<string,unknown>[], seen=new Set(previousIds);
 let duplicates=0, unavailable=0;
 const failuresToCheck=rows.filter(row=>failures.has(String(row.type))).filter(row=>{
  if (!validIdentity(row.log_id) || typeof row.date!=='string' || !Number.isFinite(Date.parse(row.date))) { unavailable++; return false; }
  if (seen.has(row.log_id)) { duplicates++; return false; }
  seen.add(row.log_id); return true;
 });
 const details:Evidence[]=[];
 let stopReason:string | undefined, retryAfterSeconds:number | undefined, rateRetries=0, retried=false;
 for (let offset=0;offset<failuresToCheck.length && active();offset+=CONCURRENCY) {
  const batch=failuresToCheck.slice(offset,offset+CONCURRENCY);
  const read=(index:number)=>invokeRead(client,token,'get_log_event',{log_id:batch[index].log_id,include_source:true},timeout);
  const responses=await pool(batch.map((_,index)=>index),read);
  const limited=responses.flatMap((response,index)=>safeError(response.error)==='RATE_LIMITED' ? [index] : []);
  const delay=retried ? undefined : retryableRateDelay(responses);
  if (delay!==undefined && active()) {
   retried=true;
   if (await waitForRetry(delay,active)) {
    const retries=await pool(limited,read); rateRetries+=retries.length;
    retries.forEach((response,index)=>{responses[limited[index]]=response;});
   }
  }
  details.push(...responses);
  stopReason=stopFor(responses);
  if (stopReason==='RATE_LIMITED') retryAfterSeconds=retryAfterFor(responses);
  if (stopReason) break;
 }
 let matchingSource=0; const verifiedEventIds:string[]=[];
 details.forEach((result,index)=>{
  const row=failuresToCheck[index], data=result.data;
  if (result.status!=='success' || !data || data.log_id!==row.log_id || data.user_id!==account.userId || data.type!==row.type || typeof data.date!=='string' || Date.parse(data.date)!==Date.parse(String(row.date)) || typeof data.source_ip!=='string') { unavailable++; return; }
  verifiedEventIds.push(String(row.log_id));
  if (data.source_ip===sourceIp) matchingSource++;
 });
 return {page,returned:rows.length,failures:failuresToCheck.length,verified:verifiedEventIds.length,matchingSource,duplicates,unavailable,unchecked:failuresToCheck.length-details.length,pageFull:rows.length===MAX_RECENT_PER_ACCOUNT,verifiedEventIds,stopReason,retryAfterSeconds,rateRetries};
}
