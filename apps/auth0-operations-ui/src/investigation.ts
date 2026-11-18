import { invokeRead, type Evidence, type ToolClient } from './operations.ts';

export type State = 'queued' | 'running' | 'completed' | 'warning' | 'failed' | 'skipped';
export type NodeId = 'search' | 'match' | 'not-found' | 'profile' | 'logs' | 'blocks' | 'aggregate' | 'diagnosis' | 'report';
export interface Step { id: NodeId; label: string; purpose: string; dependencies: NodeId[]; state: State; summary: string; started?: string; ended?: string; evidence?: Evidence; }
export interface Investigation { id: string; target: string; started: string; steps: Step[]; diagnosis?: string; }
const definitions: Array<[NodeId, string, string, NodeId[]]> = [
 ['search', 'Search Users', 'Find exact email matches.', []], ['match', 'User Found?', 'Require exactly one matching account.', ['search']],
 ['not-found', 'Account Not Found', 'Report an empty search without claiming the account does not exist.', ['match']],
 ['profile', 'Get User', 'Retrieve the confirmed account profile.', ['match']],
 ['logs', 'Get User Logs', 'Retrieve a page of recent authentication events.', ['profile']],
 ['blocks', 'Get User Blocks', 'Inspect brute-force protection records.', ['profile']],
 ['aggregate', 'Aggregate Evidence', 'Collect verified results and identify gaps.', ['logs', 'blocks']],
 ['diagnosis', 'AI Diagnosis', 'Request an unverified interpretation of current evidence.', ['aggregate']],
 ['report', 'Investigation Report', 'Summarize the available evidence and its limitations.', ['diagnosis']],
];
export function createInvestigation(target: string): Investigation { return { id: crypto.randomUUID(), target, started: new Date().toISOString(), steps: definitions.map(([id,label,purpose,dependencies]) => ({id,label,purpose,dependencies,state:'queued',summary:'Waiting for dependencies.'})) }; }
// Display only fields explicitly described by the Auth0 node contract, even if a response contains extras.
const fields: Record<string, string[]> = { search_users:['success','users','count'], get_user:['success','user_id','email','name','email_verified','blocked','last_login','logins_count','connections'], get_user_logs:['success','events','count'], get_user_blocks:['success','has_blocks','block_count','blocks'] };
const nested = new Set(['user_id','email','name','email_verified','log_id','date','type','description','connection','client_name','identifier','strategy']);
function safeValue(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(safeValue);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => nested.has(key)).map(([key,v]) => [key,safeValue(v)]));
 return value;
}
export function safeEvidence(e: Evidence): Evidence {
 if (!e.data) return e;
 const allowed = fields[e.tool] ?? [];
 return { ...e, data: Object.fromEntries(Object.entries(e.data).filter(([k]) => allowed.includes(k)).map(([k,v]) => [k,safeValue(v)])) };
}
export async function executeInvestigation(initial: Investigation, client: ToolClient, token: string, analyze: (evidence: Evidence[]) => Promise<string>, emit: (result: Investigation) => void): Promise<Investigation> {
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
 const search = await read('search','search_users',{email:initial.target});
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
 const input = {user_id: users[0].user_id};
 const profile = await read('profile','get_user',input);
 if (profile.status === 'error' || profile.data?.user_id !== input.user_id) {
  if (profile.status === 'success') finish('profile','failed','Profile user ID did not match the requested account.', profile);
  skip(['logs','blocks','aggregate','diagnosis','report'],'Account profile could not be verified.'); return current;
 }
 const [logs,blocks] = await Promise.all([read('logs','get_user_logs',input), read('blocks','get_user_blocks',input)]);
 start('aggregate'); const evidence = [search, profile, logs, blocks];
 const partial = evidence.some(e => e.status === 'error') || logs.data?.count === 0;
 finish('aggregate',partial ? 'warning' : 'completed',partial ? 'Evidence has gaps; review the individual checks.' : 'Current tool results collected.');
 start('diagnosis');
 try { const diagnosis = await analyze(evidence); current = {...current, diagnosis}; finish('diagnosis','completed','AI interpretation received; verify every claim against the evidence.'); }
 catch (error) { finish('diagnosis','failed',error instanceof Error ? error.message : 'AI interpretation failed.'); }
 start('report'); finish('report',partial || !current.diagnosis ? 'warning' : 'completed', 'Review the verified checks and any unverified AI interpretation.');
 return current;
}
