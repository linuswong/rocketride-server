import { invokeRead, type Evidence, type ToolClient } from './operations.ts';
import type { State } from './investigation.ts';

type Domain = 'identity' | 'security';
export interface Check { id: string; tool: string; label: string; purpose: string; input?: 'user_id'; }
export interface Workflow { id: string; domain: Domain; label: string; description: string; checks: Check[]; }
const users: Check = {id:'users',tool:'list_users',label:'List Users',purpose:'Retrieve one page of users.'};
const roles: Check = {id:'roles',tool:'list_roles',label:'List Roles',purpose:'Retrieve one page of tenant roles.'};
const apps: Check = {id:'applications',tool:'list_applications',label:'List Applications',purpose:'Retrieve one page of applications.'};
const connections: Check = {id:'connections',tool:'list_connections',label:'List Connections',purpose:'Retrieve one page of connections.'};
const permissions: Check = {id:'permissions',tool:'get_user_permissions',label:'Get User Permissions',purpose:'Retrieve one page of permissions for a user ID or uniquely matched email.',input:'user_id'};
const events: Check = {id:'events',tool:'search_logs',label:'Search Logs',purpose:'Retrieve one page of tenant-wide authentication events.'};
const brute: Check = {id:'brute-force',tool:'get_brute_force_settings',label:'Brute-force Settings',purpose:'Retrieve brute-force protection settings.'};
const throttle: Check = {id:'throttling',tool:'get_ip_throttling_settings',label:'IP Throttling Settings',purpose:'Retrieve IP throttling settings.'};
export const workflows: Workflow[] = [
 {id:'identity-overview',domain:'identity',label:'Identity overview',description:'Review one page each of users, roles, applications and connections.',checks:[users,roles,apps,connections]},
 ...[users,roles,permissions,apps,connections].map(c=>({id:c.id,domain:'identity' as const,label:c.label,description:c.purpose,checks:[c]})),
 {id:'security-overview',domain:'security',label:'Security overview',description:'Review recent tenant events and protection settings.',checks:[events,brute,throttle]},
 ...[events,brute,throttle].map(c=>({id:c.id,domain:'security' as const,label:c.label,description:c.purpose,checks:[c]})),
];
export interface ReviewStep {id:string; label:string; purpose:string; dependencies:string[]; state:State; summary:string; started?:string; ended?:string; evidence?:Evidence;}
export interface Finding {kind:'attention'|'gap'|'info'; message:string; stepId:string;}
export interface ReviewReport {summary:string; findings:Finding[]; limitations:string[]; aiSuggested:boolean;}
export interface Review {report?:ReviewReport; id:string; workflow:Workflow; target:string; targetKind:'user_id'|'email'; includeAI:boolean; started:string; steps:ReviewStep[]; diagnosis?:string;}
export function createReview(workflow:Workflow, target='', targetKind:'user_id'|'email'='user_id', includeAI=false): Review {
 const emailLookup=targetKind==='email' && workflow.checks.some(c=>c.input==='user_id');
 return {id:crypto.randomUUID(),workflow,target,targetKind,includeAI,started:new Date().toISOString(),steps:[
  ...(emailLookup ? [{id:'lookup',label:'Find User',purpose:'Find a unique exact email match before retrieving permissions.',dependencies:[],state:'queued' as State,summary:'Waiting to start.'}] : []),
  ...workflow.checks.map(c=>({id:c.id,label:c.label,purpose:c.purpose,dependencies:emailLookup && c.input ? ['lookup'] : [],state:'queued' as State,summary:'Waiting to start.'})),
  {id:'aggregate',label:'Aggregate Evidence',purpose:'Collect returned evidence and identify gaps.',dependencies:workflow.checks.map(c=>c.id),state:'queued',summary:'Waiting for checks.'},
  {id:'report',label:'Review Report',purpose:'Summarize the available evidence and limitations.',dependencies:['aggregate'],state:'queued',summary:'Waiting for evidence.'},
  ...(includeAI ? [{id:'diagnosis',label:'AI Analysis',purpose:'Request an unverified interpretation of the reviewed evidence.',dependencies:['report'],state:'queued' as State,summary:'Waiting for the review report.'}] : []),
 ]};
}
// Filter each result against the documented node contract before rendering or sending it to a model.
const schemas: Record<string, Record<string,string[] | null>> = {
 search_users:{success:null,count:null,users:['user_id','email','name','email_verified']},
 list_users:{success:null,count:null,users:['user_id','email','name','blocked','last_login']},
 list_roles:{success:null,count:null,roles:['id','name','description']},
 get_user_permissions:{success:null,count:null,page:null,permissions:['permission_name','resource_server_identifier','resource_server_name']},
 list_applications:{success:null,count:null,applications:['client_id','name','app_type']},
 list_connections:{success:null,count:null,connections:['id','name','strategy']},
 search_logs:{success:null,count:null,events:['log_id','date','type','description','user_id','client_name']},
 get_brute_force_settings:{success:null,enabled:null,mode:null,max_attempts:null,shields:[]},
 get_ip_throttling_settings:{success:null,enabled:null,shields:[],login_limits:['max_attempts','rate'],signup_limits:['max_attempts','rate']},
};
function scalar(value:unknown): unknown { return value === null || ['string','number','boolean'].includes(typeof value) ? value : undefined; }
function filtered(value:unknown, keys:string[]): unknown {
 if (Array.isArray(value)) return value.map(v => keys.length ? filtered(v,keys) : scalar(v)).filter(v=>v!==undefined);
 if (value && typeof value === 'object') return Object.fromEntries(keys.flatMap(k=>{const v=scalar((value as Record<string,unknown>)[k]); return v===undefined?[]:[[k,v]];}));
 return scalar(value);
}
export function filterReviewEvidence(e: Evidence): Evidence {
 if (!e.data) return e;
 const schema=schemas[e.tool] ?? {};
 return {...e,data:Object.fromEntries(Object.entries(schema).flatMap(([key,keys])=>{const v=keys ? filtered(e.data![key],keys) : scalar(e.data![key]); return v===undefined?[]:[[key,v]];}))};
}
/** Bounded checks of returned values, not a tenant-wide security assessment. */
export function evaluateReview(evidence:Evidence[], checks:Check[]): ReviewReport {
 const findings:Finding[]=[]; let assessed=false; let inventoryOnly=false;
 const add=(kind:Finding['kind'],message:string,stepId:string)=>findings.push({kind,message,stepId});
 for (const check of checks) {
  const e=evidence.find(item=>item.tool===check.tool);
  if (!e || e.status==='error' || !e.data) {add('gap', `${check.label} failed or returned no usable response${e?.error ? `: ${e.error}` : '.'}`,check.id); continue;}
  const data=e.data;
  if (check.tool==='list_users') {
   const users=data.users as Array<Record<string,unknown>>; const blocked=users.filter(u=>u.blocked===true).length; const unknown=users.filter(u=>typeof u.blocked!=='boolean').length;
   if (users.length && !unknown) assessed=true;
   if (blocked) add('attention',`${blocked} returned user(s) have an administrative block. Confirm whether each block is expected.`,check.id);
   if (unknown) add('gap',`${unknown} returned user(s) have no valid administrative block status.`,check.id);
   if (!users.length) add('info','No users were returned on this page.',check.id);
  } else if (check.tool==='search_logs') {
   const events=data.events as Array<Record<string,unknown>>; const relevant=events.filter(event=>['f','fp','fu','limit_wc','limit_sul','limit_mu'].includes(String(event.type))).length;
   if (!events.length) add('gap','No authentication events were returned on this page; there is insufficient event evidence.',check.id);
   else {assessed=true; if (relevant) add('attention',`${relevant} returned event(s) indicate a sign-in failure or protection limit. Review their context; they do not by themselves establish an attack.`,check.id); if (events.some(e=>typeof e.type!=='string' || !e.type)) add('gap','Some returned events have no event type and cannot be assessed.',check.id);}
  } else if (check.tool==='get_brute_force_settings' || check.tool==='get_ip_throttling_settings') {
   if (typeof data.enabled!=='boolean') add('gap',`${check.label} did not return a valid enabled state.`,check.id);
   else {assessed=true; if (!data.enabled) add('attention',`${check.label} reports protection is disabled. Verify this against your security policy.`,check.id); else add('info',`${check.label} reports protection is enabled.`,check.id);}
  } else {
   inventoryOnly=true;
   if (data.count===0) add('info',`${check.label} returned no items on this page. This is not a tool error.`,check.id);
   else add('info',`${check.label} returned ${String(data.count)} item(s). The app has no policy baseline to judge whether they are appropriate.`,check.id);
  }
 }
 const attention=findings.some(f=>f.kind==='attention'); const gaps=findings.some(f=>f.kind==='gap');
 const summary=attention?'Items need review in the returned data.':gaps?'Review incomplete: some evidence is missing or inaccessible.':assessed?'No configured checks flagged a concern in the returned data.':'Results retrieved; no automatic policy assessment is available for these inventory checks.';
 const limitations=['This report checks only the selected rules and returned data; it cannot establish that the tenant is secure.','List and event results cover only the returned page, not a complete inventory or history.'];
 if (inventoryOnly) limitations.push('Roles, permissions, applications and connections are not compared with your organization’s policy.');
 return {summary,findings,limitations,aiSuggested:attention};
}
export function reviewAnalysisEvidence(workflow: Review['workflow'], evidence: Evidence[]): Evidence[] {
 if (workflow.id !== 'identity-overview') return evidence;
 // The overview is page-scoped. Send counts and block status without the inventory records.
 return evidence.map(({tool, status, data}) => {
  const counts: Record<string, unknown> = {};
  if (status === 'success' && typeof data?.count === 'number') counts.page_count = data.count;
  if (status === 'success' && tool === 'list_users' && Array.isArray(data?.users)) {
   counts.administratively_blocked_on_page = data.users.filter(user => user?.blocked === true).length;
   counts.unknown_block_status_on_page = data.users.filter(user => typeof user?.blocked !== 'boolean').length;
  }
  return {tool, status, data: counts};
 });
}

export async function executeReview(initial:Review, client:ToolClient, token:string, analyze:(evidence:Evidence[])=>Promise<string>, emit:(review:Review)=>void):Promise<Review> {
 let current=initial;
 const update=(id:string,patch:Partial<ReviewStep>)=>{current={...current,steps:current.steps.map(s=>s.id===id?{...s,...patch}:s)};emit(current);};
 const start=(id:string)=>update(id,{state:'running',summary:'Executing…',started:new Date().toISOString()});
 const finish=(id:string,state:State,summary:string,evidence?:Evidence)=>update(id,{state,summary,evidence,ended:new Date().toISOString()});
 let userId=initial.target;
 const lookupEvidence:Evidence[]=[];
 if (initial.targetKind==='email' && initial.workflow.checks.some(c=>c.input==='user_id')) {
  start('lookup'); const lookup=filterReviewEvidence(await invokeRead(client,token,'search_users',{email:initial.target})); lookupEvidence.push(lookup);
  const users=lookup.data?.users as Array<Record<string,unknown>> | undefined;
  const valid=lookup.status==='success' && users?.length===1 && typeof users[0].user_id==='string' && !!users[0].user_id.trim() && typeof users[0].email==='string' && users[0].email.toLowerCase()===initial.target.toLowerCase();
  if (!valid) {
   const message=lookup.status==='error' ? lookup.error ?? 'User search failed.' : users?.length===0 ? 'No exact match returned; check the email and allow for indexing delay.' : users && users.length>1 ? 'Multiple accounts matched. Use a user ID to choose the correct account.' : 'The returned account did not match the requested email.';
   finish('lookup',lookup.status==='error'?'failed':'warning',message,lookup);
   initial.workflow.checks.forEach(check=>finish(check.id,'skipped','A unique matching user is required.'));
   current={...current,report:{summary:'Review incomplete: a unique matching account was not established.',findings:[{kind:'gap',message,stepId:'lookup'}],limitations:['Permissions were not retrieved.'],aiSuggested:false}}; finish('aggregate','skipped','Permissions were not retrieved.'); finish('report','warning',message); if (initial.includeAI) finish('diagnosis','skipped','No permissions were retrieved.'); return current;
  }
  userId=users![0].user_id as string; finish('lookup','completed','One exact match returned.',lookup);
 }
 const evidence=await Promise.all(initial.workflow.checks.map(async check=>{
  start(check.id); const result=filterReviewEvidence(await invokeRead(client,token,check.tool,check.input ? {[check.input]:userId} : {}));
  const empty=result.status==='success' && result.data?.count===0 && check.tool==='search_logs';
  const state:State=result.status==='error'?'failed':empty?'warning':'completed';
  finish(check.id,state,result.error ?? (empty?'No events returned on this page; evidence is insufficient.':result.data?.count===0?'No items returned on this page.':check.tool==='search_logs'?'A page of tenant-wide events was returned; it does not establish the cause of an individual sign-in.':'Tool execution succeeded. Review the returned values.'),result);
  return result;
 }));
 start('aggregate'); const report=evaluateReview(evidence,initial.workflow.checks); current={...current,report}; const partial=report.findings.some(f=>f.kind==='gap'); const needsAttention=report.findings.some(f=>f.kind==='attention');
 finish('aggregate',partial || needsAttention?'warning':'completed',report.summary);
 start('report'); finish('report',partial || needsAttention?'warning':'completed',report.summary);
 if (evidence.every(e=>e.status==='error')) { if (initial.includeAI) finish('diagnosis','skipped','No successful evidence to analyze.'); return current; }
 if (!initial.includeAI) return current;
 start('diagnosis'); try {const diagnosis=await analyze(reviewAnalysisEvidence(initial.workflow,[...lookupEvidence,...evidence])); current={...current,diagnosis}; finish('diagnosis','completed','AI analysis received; verify every claim against the evidence.');} catch(error) {finish('diagnosis','failed',error instanceof Error?error.message:'AI analysis failed.');}
 return current;
}
