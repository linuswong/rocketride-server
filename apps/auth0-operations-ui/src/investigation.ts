import { invokeRead, type Evidence, type ToolClient } from './operations.ts';

export type State = 'queued' | 'running' | 'completed' | 'warning' | 'failed' | 'skipped';
export type NodeId = 'search' | 'match' | 'not-found' | 'profile' | 'logs' | 'blocks' | 'aggregate' | 'diagnosis' | 'report';
export interface Step { id: NodeId; label: string; purpose: string; dependencies: NodeId[]; state: State; summary: string; started?: string; ended?: string; evidence?: Evidence; }
export interface Investigation { id: string; target: string; started: string; steps: Step[]; diagnosis?: string; }
export interface Finding { category: 'confirmed' | 'inconclusive' | 'not observed'; text: string; source: NodeId; }
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'unknown';
export interface StepView { step: Step; execution: ExecutionStatus; severity: 'warning' | 'none'; }
/** Legacy warning means the application completed a check with a diagnostic caveat. */
export function stepView(step: Step): StepView {
 const execution: ExecutionStatus = step.state === 'queued' ? 'pending' : step.state === 'warning' ? 'completed' : ['running','completed','failed','skipped'].includes(step.state) ? step.state as ExecutionStatus : 'unknown';
 return {step, execution, severity: step.state === 'warning' || (step.id === 'profile' && step.evidence?.data?.blocked === true) || (step.id === 'blocks' && step.evidence?.data?.has_blocks === true) ? 'warning' : 'none'};
}
export function validateTarget(value: string): string | undefined {
 const target = value.trim();
 if (target.length > 254 || [...target].some(char => char.charCodeAt(0) < 32)) return 'Enter a valid email address or Auth0 user ID.';
 if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || /^[A-Za-z0-9_-]+\|[^\s|]+$/.test(target)) return undefined;
 return 'Enter a valid email address or Auth0 user ID, such as auth0|123.';
}
/** Only derive findings that are directly supported by validated results. */
export function findings(result: Investigation): Finding[] {
 const get = (id: NodeId) => { const step = result.steps.find(item => item.id === id); return step?.state === 'failed' && step.evidence?.status === 'success' ? undefined : step?.evidence; };
 const profile = get('profile'), blocks = get('blocks'), logs = get('logs');
 const items: Finding[] = [];
 const search = get('search');
 if (search?.status === 'success' && search.data?.count === 0) items.push({category:'inconclusive',text:'No matching account was returned; verify the identifier and search indexing.',source:'search'});
 if (profile?.status === 'success') items.push({category: profile.data?.blocked === true ? 'confirmed' : 'not observed', text: profile.data?.blocked === true ? 'The account profile reports an administrative block.' : 'The account profile does not report an administrative block.', source:'profile'});
 if (blocks?.status === 'success') items.push({category: blocks.data?.has_blocks === true ? 'confirmed' : 'not observed', text: blocks.data?.has_blocks === true ? 'Brute-force protection records were returned.' : 'No brute-force block records were returned by this check.', source:'blocks'});
 if (logs?.status === 'success') items.push({category: logs.data?.count === 0 ? 'inconclusive' : 'confirmed', text: logs.data?.count === 0 ? 'No events were returned on this page; the cause is unknown.' : 'Authentication events were returned; inspect their types and timestamps.', source:'logs'});
 if (logs?.status === 'success' && Array.isArray(logs.data?.events) && logs.data.events.some(event => event && typeof event === 'object' && (event as Record<string,unknown>).type === 'f')) items.push({category:'confirmed',text:'A failed login event was returned; it does not establish the cause.',source:'logs'});
 for (const [type, label] of [['fp','incorrect-password'], ['fu','unknown-user']] as const) {
  if (logs?.status === 'success' && Array.isArray(logs.data?.events) && logs.data.events.some(event => event && typeof event === 'object' && (event as Record<string,unknown>).type === type)) items.push({category:'confirmed',text:`A ${type} (${label}) event was returned; inspect its timestamp and context.`,source:'logs'});
 }
 for (const id of ['profile','logs','blocks'] as const) if (result.steps.find(step => step.id === id)?.state === 'failed') items.push({category:'inconclusive',text:'This check failed; its absence cannot rule out a problem.',source:id});
 return items;
}
export function investigationRecommendation(result: Investigation) {
 const step = (id: NodeId) => result.steps.find(item => item.id === id);
 const actions: Array<{source: NodeId; text: string}> = [];
 if (step('profile')?.state !== 'completed') {
  return {
   status: 'More evidence needed',
   reason: 'The investigation could not verify the account.',
   actions: [{source: 'profile' as const, text: 'Confirm the exact account identifier and retry the account lookup.'}],
  };
 }
 if (step('profile')?.evidence?.data?.blocked === true) {
  actions.push({source: 'profile', text: 'Ask an authorized administrator to verify why the account was blocked and determine whether it should remain blocked.'});
 }
 if (step('blocks')?.evidence?.data?.has_blocks === true) {
  actions.push({source: 'blocks', text: 'Review the protection records against the time of the reported sign-in issue before considering recovery.'});
 }
 const logs = step('logs')?.evidence?.data?.events;
 if (Array.isArray(logs) && logs.some(event => ['f', 'fp', 'fu'].includes(event?.type))) {
  actions.push({source: 'logs', text: 'Compare the failed sign-in event with the time and error reported by the user.'});
 }
 if (actions.length) return {status: 'Follow-up needed', reason: 'The account checks found signals that warrant review.', actions};
 const gaps = (['logs', 'blocks'] as const).filter(id => step(id)?.state !== 'completed' || step(id)?.evidence?.status !== 'success');
 if (gaps.length) return {
  status: 'More evidence needed',
  reason: 'The available checks are incomplete.',
  actions: gaps.map(source => ({source, text: source === 'logs'
   ? 'Check the authentication logs for the time of the reported sign-in issue.'
   : 'Retry the incomplete check and review its result.'})),
 };
 return {status: 'No action indicated', reason: 'The available account checks surfaced no issue that calls for a recovery action.', actions};
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
export function createInvestigation(target: string): Investigation { return { id: crypto.randomUUID(), target, started: new Date().toISOString(), steps: definitions.map(([id,label,purpose,dependencies]) => ({id,label,purpose,dependencies,state:'queued',summary:'Waiting for dependencies.'})) }; }
// Display only fields explicitly described by the Auth0 node contract, even if a response contains extras.
const fields: Record<string, string[]> = { search_users:['success','users','count'], get_user:['success','user_id','email','name','email_verified','blocked','last_login','logins_count','connections'], get_user_logs:['success','events','count'], get_user_blocks:['success','has_blocks','block_count','blocks'] };
const nested = new Set(['user_id','email','name','email_verified','log_id','date','type','description','connection','client_name','identifier','strategy']);
function safeValue(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(safeValue);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => nested.has(key)).map(([key,v]) => [key,safeValue(v)]));
 if (typeof value === 'string') return value.replace(/\b(Bearer\s+)[^\s]+/gi, '$1[redacted]').replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
 return value;
}
export function safeEvidence(e: Evidence): Evidence {
 const input = e.input ? Object.fromEntries(Object.entries(e.input).filter(([key]) => ['email','user_id'].includes(key)).map(([key,value]) => [key,safeValue(value)])) : undefined;
 if (!e.data) return {...e, input};
 const allowed = fields[e.tool] ?? [];
 return { ...e, input, data: Object.fromEntries(Object.entries(e.data).filter(([k]) => allowed.includes(k)).map(([k,v]) => [k,safeValue(v)])) };
}
export async function executeInvestigation(initial: Investigation, client: ToolClient, token: string, analyze: ((evidence: Evidence[]) => Promise<string>) | undefined, emit: (result: Investigation) => void): Promise<Investigation> {
 const validation = validateTarget(initial.target);
 if (validation) throw new Error(validation);
 let current = initial;
 const update = (id: NodeId, patch: Partial<Step>) => { current = {...current, steps:current.steps.map(s => s.id === id ? {...s,...patch} : s)}; emit(current); };
 const now = () => new Date().toISOString();
 const start = (id: NodeId) => update(id,{state:'running',started:now(),summary:'Executing…'});
 const finish = (id: NodeId, state: State, summary: string, evidence?: Evidence) => update(id,{state,summary,evidence,ended:now()});
 const skip = (ids: NodeId[], reason: string) => ids.forEach(id => finish(id,'skipped',reason));
 const read = async (id: NodeId, tool: string, input: Record<string, unknown>) => {
  start(id); const result = safeEvidence(await invokeRead(client, token, tool, input));
  let state: State = result.status === 'error' ? 'failed' : 'completed';
  let summary = result.error ?? 'Tool execution succeeded.';
  if (result.status === 'success' && id === 'logs' && result.data?.count === 0) { state = 'warning'; summary = 'No events returned on this page; evidence is insufficient.'; }
  if (result.status === 'success' && id === 'blocks') summary = result.data?.has_blocks ? 'Block records returned. Review them; no action was taken.' : 'No block records returned by this check.';
  if (result.status === 'success' && id === 'profile' && result.data?.blocked === true) summary = 'The profile reports an administrative block.';
  finish(id,state,summary,result); return result;
 };
 let userId: string;
 let search: Evidence | undefined;
 if (initial.target.includes('|')) {
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
 const [logs,blocks] = await Promise.all([read('logs','get_user_logs',input), read('blocks','get_user_blocks',input)]);
 start('aggregate'); const evidence = [search, profile, logs, blocks].filter((item): item is Evidence => item !== undefined);
 const partial = evidence.some(e => e.status === 'error') || logs.data?.count === 0;
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
