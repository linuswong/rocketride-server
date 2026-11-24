// Isolated test host: no shell, engine, credentials or network integration.
import React, { useState } from 'react';
import '../../src/styles.css';
import './fixture.css';
import { LoginLens, type LensPage } from '../../src/LoginLens';
import { LensSidebar } from '../../src/lens/LensSidebar';
import { lensPages } from '../../src/lens/pages';
import { createRoot } from 'react-dom/client';
import { InvestigationWorkspace } from '../../src/InvestigationWorkspace';
import { demoClient } from '../../src/offlineDemo';
import { SupportPlatform, type SupportPage } from '../../src/SupportPlatform';
import { AccountInvestigation } from '../../src/AccountInvestigation';
import { accountAnalysisPayload } from '../../src/accountAnalysis';
import { parseAccountAnalysisResponse } from '../../src/analysisResponse';
import type { Evidence } from '../../src/operations';
import type { HistoryStop } from '../../src/investigation';
import { TelemetryTaskMismatchError, TelemetryTaskTimeoutError } from '../../src/telemetryTask';

// Exercise the map's no-WebGL fallback without changing production behavior.
if (new URLSearchParams(location.search).has('nogl')) {
 const getContext = HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
  if (type === 'webgl' || type === 'webgl2') return null;
  return (getContext as (...args: any[]) => any).call(this, type, ...args);
 } as typeof HTMLCanvasElement.prototype.getContext;
}

function Fixture() {
 const [busy, setBusy] = useState(false);
 const [page, setPage] = useState<SupportPage>('Dashboard');
 const requestedPage = lensPages.find(item => item === new URLSearchParams(location.search).get('page'));
 const [lensPage, setLensPage] = useState<LensPage>(requestedPage ?? (new URLSearchParams(location.search).has('manual') ? 'Analytics' : 'Overview'));
 const [alertCount, setAlertCount] = useState<number | null>(null);
 const lensFrame = (lens: React.ReactElement) => <main className="app lens-fixture"><LensSidebar page={lensPage} navigate={setLensPage} alertCount={alertCount}/>{React.cloneElement(lens, {page:lensPage, navigate:setLensPage, onAlertCount:setAlertCount})}</main>;
 const [events] = useState(() => Array.from({length:4},(_,i)=>({log_id:'mock-'+i,date:new Date(Date.now()-5000-i*1000).toISOString(),type:'fp',description:'Login failed.',account_group:1,source_group:1})));
 const [agentRows] = useState(() => Array.from({length:new URLSearchParams(location.search).has('scenario18')?18:8},(_,i)=>({log_id:`private-event-${i}`,date:new Date(Date.now()-5000-i*1000).toISOString(),type:'fp',description:'Login failed.',account_group:new URLSearchParams(location.search).has('scenario18')?(i===8?1:Math.floor(i/2)+1):i+1,source_group:new URLSearchParams(location.search).has('scenario18')?(i<8?1:2+Math.floor((i-8)/2)):(i<4?1:2),client_name:'private-app'})));
 if (new URLSearchParams(location.search).has('accountcase')) return <main className="app lens-root"><AccountInvestigation active client={null} connected={false} start={async()=>{throw Error('Offline');}} analyze={async()=>{throw Error('Offline');}} busy={busy} setBusy={setBusy}/></main>;
 if (new URLSearchParams(location.search).has('accountpages')) {
  const client = {tool:async ({tool,input}:{tool:string;input:Record<string,unknown>})=>{
   document.documentElement.dataset.accountCalls=JSON.stringify([...(JSON.parse(document.documentElement.dataset.accountCalls ?? '[]') as string[]),tool]);
   if (new URLSearchParams(location.search).has('slowaccount') && ['get_user_logs','search_submitted_email_logs'].includes(tool)) await new Promise(resolve=>setTimeout(resolve,600));
   if (tool === 'search_users') return new URLSearchParams(location.search).has('sharedfailure') ? {success:false,error_code:'RATE_LIMITED'} : new URLSearchParams(location.search).has('nouser') ? {success:true,users:[],count:0} : new URLSearchParams(location.search).has('multi') ? {success:true,users:[{user_id:'auth0|fixture',email:'person@example.com'},{user_id:'google-oauth2|fixture2',email:'person@example.com'}],count:2} : {success:true,users:[{user_id:'auth0|fixture',email:'person@example.com'}],count:1};
   if (tool === 'get_users_by_email') return {success:true,users:[{user_id:'auth0|fixture',email:input.email}],count:1};
   if (tool === 'get_user') return {success:true,user_id:input.user_id,email:new URLSearchParams(location.search).has('profilechanged') ? 'other@example.com' : 'person@example.com',blocked:false,connections:[]};
   if (tool === 'get_user_blocks') return new URLSearchParams(location.search).has('blockscope') ? {success:false,error_code:'MISSING_SCOPE'} : {success:true,has_blocks:false,block_count:0,blocks:[]};
   if (tool === 'get_blocks_by_email') return new URLSearchParams(location.search).has('refreshfail') && JSON.parse(document.documentElement.dataset.accountCalls ?? '[]').filter((name:string)=>name===tool).length === 2 ? {success:false,error_code:'RATE_LIMITED'} : {success:true,has_blocks:true,block_count:1};
   if (tool === 'search_submitted_email_logs') { if(new URLSearchParams(location.search).has('refreshfail') && JSON.parse(document.documentElement.dataset.accountCalls ?? '[]').filter((name:string)=>name===tool).length === 2) return {success:false,error_code:'RATE_LIMITED'}; document.documentElement.dataset.submittedQuery=JSON.stringify(input); if(new URLSearchParams(location.search).has('emailpages')) { if(input.page) {if(new URLSearchParams(location.search).has('emailpagefail')) return {success:false,error_code:'RATE_LIMITED'}; const events=[{log_id:'tenant-0',date:'2026-01-01T12:00:00Z',type:'fu',description:'Fictional failure'},{log_id:'tenant-older',date:'2026-01-01T11:59:00Z',type:'fp',description:'Fictional failure'}]; return {success:true,events,count:2,page_full:false,rejected:0,page:input.page};} const events=Array.from({length:50},(_,i)=>({log_id:`tenant-${i}`,date:'2026-01-01T12:00:00Z',type:'fu',description:'Fictional failure'})); return {success:true,events,count:50,page_full:true,rejected:0,page:0}; } return {success:true,events:[{log_id:'tenant-event',date:'2026-01-01T12:00:00Z',type:'fu',description:'Fictional failure',client_name:'Fictional app'}],count:1,page_full:false,rejected:0}; }
   if (tool === 'get_user_logs') { if (new URLSearchParams(location.search).has('mfa')) {const events=[{log_id:'mfa-fail',date:'2026-01-01T12:00:00Z',type:'gd_auth_failed',description:null},{log_id:'mfa-success',date:'2026-01-01T12:00:01Z',type:'gd_auth_succeed',description:null}]; return {success:true,events,count:events.length};} const events = input.page ? [{log_id:'older',date:'2026-01-01T12:00:00Z',type:'fp',description:'Fictional failure',client_name:'Fictional app'}] : Array.from({length:50},(_,i)=>({log_id:`new-${i}`,date:i===49?'2026-01-01T12:10:00Z':new Date(Date.parse('2026-01-01T14:00:00Z')-i*1000).toISOString(),type:'s',description:'Fictional success',client_name:'Fictional app'})); return {success:true,events,count:events.length}; }
   return {success:false,error_code:'INVALID_INPUT'};
  }};
  const analyze = async (_token:string, evidence:Evidence[], stop?:HistoryStop) => {
   const payload=accountAnalysisPayload(evidence,stop);
   document.documentElement.dataset.accountPayload=JSON.stringify(payload);
   const allowed=new Set(payload.checks.filter(item=>item.status==='success').map(item=>item.reference));
   const answer=parseAccountAnalysisResponse(JSON.stringify({takeaway:'A failure was returned.',nextStep:'Compare the event.',references:['E4']}),allowed);
   if (!answer) throw Error('Invalid fixture response');
   return JSON.stringify(answer);
  };
  return <main className="app lens-root" data-fixture="accountpages"><AccountInvestigation active client={client} connected start={async()=> {if(new URLSearchParams(location.search).has('mismatched')) throw new TelemetryTaskMismatchError(); if(new URLSearchParams(location.search).has('starttimeout')) throw new TelemetryTaskTimeoutError('start'); return 'fixture';}} analyze={analyze} busy={busy} setBusy={setBusy}/></main>;
 }
 if (new URLSearchParams(location.search).has('agentmock')) {
  const rows = agentRows;
  const client = {tool:async ({tool,input}:{tool:string;input:Record<string,unknown>})=>{
   document.documentElement.dataset.fixtureReads=String(Number(document.documentElement.dataset.fixtureReads ?? 0)+1);
   document.documentElement.dataset.fixtureTools=[document.documentElement.dataset.fixtureTools,tool].filter(Boolean).join(',');
   if (tool==='get_log_event' && input.log_id==='later-success' && new URLSearchParams(location.search).has('latersuccess')) return {success:true,log_id:'later-success',date:new Date(Date.parse(rows[0].date)+1000).toISOString(),type:'s',description:'Fictional success',user_id:'auth0|mock-1',source_ip:'192.0.2.10',...(input.include_application ? {client_id:'private-client-id'} : {})};
   if (tool==='get_log_event') { if (input.compare_source && new URLSearchParams(location.search).has('missingscope')) return {success:false,error_code:'MISSING_SCOPE'}; const event=rows.find(item=>item.log_id===input.log_id); return event ? {success:true,...event,user_id:input.analytics?undefined:`auth0|mock-${event.account_group}`,source_ip:`192.0.2.${9+event.source_group}`,...(input.include_application ? {client_id:'private-client-id'} : {}),...(input.include_fingerprint ? {ja3:'0'.repeat(32),ja4:'t13d1516h2_8daaf6152771_b186095e22b6'} : {}),brute_force_allowlisted:false,ip_throttling_allowlisted:false} : {success:false,error_code:'NOT_FOUND'}; }
   if (tool==='compare_network_acl_ranges') { if (new URLSearchParams(location.search).has('ratelimit')) return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:31}; if (new URLSearchParams(location.search).has('missingacl')) return {success:false,error_code:'MISSING_SCOPE'}; const event=rows.find(item=>item.log_id===input.log_id); return event ? {success:true,...event,source_ip:`192.0.2.${9+event.source_group}`,ip_range_matches:1,active_rules_checked:2,coverage:'retrieved'} : {success:false,error_code:'NOT_FOUND'}; }
   if (tool==='get_user') return {success:true,user_id:input.user_id,email:null,blocked:new URLSearchParams(location.search).has('verifiedblock') && input.user_id==='auth0|mock-1',connections:[]};
   if (tool==='get_application_config') return {success:true,client_id:input.client_id,app_type:'spa',token_endpoint_auth_method:'none',authorization_code_enabled:true,password_enabled:false,refresh_token_enabled:true,client_credentials_enabled:false};
   if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
   if (tool==='get_user_logs') {
    if (new URLSearchParams(location.search).has('latersuccess') && input.user_id==='auth0|mock-1') return {success:true,events:[{log_id:'later-success',date:new Date(Date.parse(rows[0].date)+1000).toISOString(),type:'s',description:'Fictional success'}],count:1};
    if (new URLSearchParams(location.search).has('historypreflight') && input.user_id==='auth0|mock-1') {
     if (input.page) return {success:true,events:[],count:0};
     const userRows=rows.filter(item=>`auth0|mock-${item.account_group}`===input.user_id);
     const extra=Array.from({length:20-userRows.length},(_,i)=>({log_id:`fixture-older-current-${i}`,date:new Date(Date.now()-60000-i*1000).toISOString(),type:'s',description:'Fictional login'}));
     return {success:true,events:[...userRows,...extra],count:20};
    }
    const userRows=rows.filter(item=>`auth0|mock-${item.account_group}`===input.user_id); return {success:true,events:userRows,count:userRows.length};
   }
   if (tool==='get_brute_force_settings' || tool==='get_ip_throttling_settings') return {success:true,enabled:true};
   if (tool==='search_logs') return {success:true,events:rows,count:rows.length};
   if (tool==='search_authentication_history') { const selected=rows.filter(item=>Date.parse(item.date)>=Date.parse(String(input.start)) && Date.parse(item.date)<=Date.parse(String(input.end))); return {success:true,events:selected,count:selected.length,pages:1,coverage:'retrieved',reason:null,rejected:0,duplicates:0,retry_after_seconds:null}; }
   return {success:false,error_code:'INVALID_INPUT'};
  }};
  const model=async (_instructions:string,payload:unknown)=>{
   const data=payload as {candidates:{id:string}[];evidence:{observations:{tool:string;state:string;period?:string}[]}};
   const calls=Number(document.documentElement.dataset.modelCalls ?? 0)+1;
   document.documentElement.dataset.modelCalls=String(calls);
   document.documentElement.dataset.safePayload=String(!/private-event|private-app|private-client-id|later-success|auth0\|mock|192\.0\.2/.test(JSON.stringify(payload)) && !JSON.stringify(payload).includes('0'.repeat(32)) && !JSON.stringify(payload).includes('t13d1516h2_8daaf6152771_b186095e22b6'));
   if (new URLSearchParams(location.search).has('ratelimit')) return calls===1 ? JSON.stringify({decision:'check',candidate:'source-2'}) : JSON.stringify({decision:'conclude',action:'Wait for the Auth0 rate limit to clear, then rerun.',reason:'The fictional source check was rate limited.',uncertainty:'The cause remains unknown.',references:['source-analysis']});
   if (new URLSearchParams(location.search).has('reviewagain')) return calls===1 ? JSON.stringify({decision:'conclude',action:"Review the bruteForceAllowlisted configuration for the source.",reason:'The source was checked.',uncertainty:'The business policy is unknown.',references:['source-analysis']}) : JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The source and allowlist were checked.',uncertainty:'The business policy remains unknown.',references:['source-analysis']});
   if (new URLSearchParams(location.search).has('genericloop')) return calls<=3 ? JSON.stringify({decision:'conclude',action:'Review the checked pattern.',reason:'The source was checked.',uncertainty:'The cause is unknown.',references:['source-accounts']}) : JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The additional source group was checked.',uncertainty:'The cause remains unknown.',references:['followup-1']});
   if (new URLSearchParams(location.search).has('exhaust')) {document.documentElement.dataset.exhaustedBeforeConclusion=String(data.evidence.observations.some(item=>item.tool==='search_authentication_history' && item.period==='previous_24h'));return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The checked failures do not establish a cause.',uncertainty:'The cause remains unknown.',references:['source-accounts']});}
   if (new URLSearchParams(location.search).has('historypreflight')) {
    document.documentElement.dataset.historyBeforeModel=String(data.evidence.observations.some(item=>item.tool==='investigate_account_history' && item.state==='success'));
    return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The account history was checked.',uncertainty:'The cause remains unknown.',references:['source-accounts']});
   }
   if (calls===1 && data.candidates.some(item=>item.id==='source-2')) return JSON.stringify({decision:'check',candidate:'source-2'});
   return JSON.stringify({decision:'conclude',action:'Do not reset credentials solely for these events.',reason:'The fictional source groups were checked.',uncertainty:'Intent is unknown.',references:['source-accounts','followup-1']});
  };
  return lensFrame(<LoginLens connected client={client} model={model} startData={async()=> 'fixture'} renderAccountInvestigation={(active,prefill)=><AccountInvestigation active={active} prefill={prefill} client={client} connected start={async()=> 'fixture'} analyze={async()=>''} busy={busy} setBusy={setBusy}/>}/>);
 }
 if (new URLSearchParams(location.search).has('lensmock') || new URLSearchParams(location.search).has('lensplanner')) {
  if (new URLSearchParams(location.search).has('fastpoll')) { const realSetTimeout=window.setTimeout.bind(window); window.setTimeout=((handler:TimerHandler, timeout?:number, ...args:unknown[])=>realSetTimeout(handler,timeout===300000 ? 1000 : timeout,...args)) as typeof window.setTimeout; }
  const client = {tool: async (options: {tool:string; input:Record<string,unknown>}) => {
   document.documentElement.dataset.fixtureCalls = String(Number(document.documentElement.dataset.fixtureCalls ?? 0) + 1);
   document.documentElement.dataset.fixtureTools = [document.documentElement.dataset.fixtureTools, options.tool].filter(Boolean).join(',');
   if (options.tool === 'search_authentication_history' && new URLSearchParams(location.search).has('pollfail') && Number(document.documentElement.dataset.fixtureCalls) >= 2) return {success:false,error_code:'RATE_LIMITED'};
   if (options.tool === 'list_users') { const users = [{user_id:'fixture-active',last_login:new Date(Date.now()-86400000).toISOString()},{user_id:'fixture-inactive',last_login:new Date(Date.now()-40*86400000).toISOString()},{user_id:'fixture-unknown',last_login:null}]; return {success:true,users,count:users.length}; }
   if (options.tool === 'get_log_event' && new URLSearchParams(location.search).has('failurelead')) return {success:true,...events.find(event=>event.log_id===options.input.log_id),user_id:null,user_name:'person@example.com'};
   if (options.tool === 'get_log_event' && options.input.log_id === 'fixture-mfa') return {success:true,log_id:'fixture-mfa',type:new URLSearchParams(location.search).has('mfamismatch') ? 'gd_auth_failed' : 'gd_otp_rate_limit_exceed',date:document.documentElement.dataset.mfaTime,description:null,user_id:'auth0|fixture-mfa'};
   if (options.tool === 'get_log_event') return {success:true,...events.find(event => event.log_id === options.input.log_id)};
   if (options.tool === 'get_brute_force_settings') return new URLSearchParams(location.search).has('runfail') ? {success:false,error_code:'DENIED'} : {success:true,enabled:true};
   const historyEvents = options.tool === 'search_authentication_history' && new URLSearchParams(location.search).has('fastpoll') && Number(document.documentElement.dataset.fixtureCalls) >= 2 ? [...events,{log_id:'fixture-new-failure',date:String(options.input.end),type:'f',description:'Fictional failure'},{log_id:'fixture-new-mfa',date:String(options.input.end),type:'gd_otp_rate_limit_exceed',description:'Fictional MFA event'}] : events;
   if (options.tool === 'search_authentication_history' && new URLSearchParams(location.search).has('mfaevents')) document.documentElement.dataset.mfaTime=String(options.input.end);
   const withMfa = options.tool === 'search_authentication_history' && new URLSearchParams(location.search).has('mfaevents') ? [...historyEvents,{log_id:'fixture-mfa',date:String(options.input.end),type:'gd_otp_rate_limit_exceed',description:'Fictional MFA rate limit'}] : historyEvents;
   return {success:true,events:withMfa,count:withMfa.length,pages:1,coverage:'retrieved',reason:null,rejected:0,duplicates:0,retry_after_seconds:null};
  }};
  return lensFrame(<LoginLens connected client={client} model={async(instructions)=>{document.documentElement.dataset.modelCalls=String(Number(document.documentElement.dataset.modelCalls ?? 0)+1); return instructions.startsWith('Interpret the supplied investigation') ? JSON.stringify({findings:[{reference:'event',possibleCause:'A stale credential may explain the failure.',uncertainty:'One event cannot establish intent.',nextStep:'Compare the event with the sign-in report.',possibleRemediation:'If verified, use the standard recovery process.'}]}) : new URLSearchParams(location.search).has('runtime') ? await (await fetch('/' + new URLSearchParams(location.search).get('response'))).text() : new URLSearchParams(location.search).has('badplan') ? '{"steps":[' : '```json\n'+JSON.stringify({steps:[{id:'event',tool:'get_log_event',purpose:'Verify event',expected:'Type and time',depends:[],ref:'E1'},...(new URLSearchParams(location.search).has('runfail') ? [{id:'settings',tool:'get_brute_force_settings',purpose:'Check settings',expected:'Settings',depends:[]}] : [])]})+'\n```';}} startData={async()=> 'fixture'} renderAccountInvestigation={(active,prefill)=><AccountInvestigation active={active} prefill={prefill} client={client} connected start={async()=> 'fixture'} analyze={async()=>''} busy={busy} setBusy={setBusy}/>}/>);
 }
 if (new URLSearchParams(location.search).has('lens')) return lensFrame(<LoginLens connected={false} client={null} model={async()=>{throw Error('Offline');}} startData={async()=>{throw Error('Offline');}}/>);
 if (new URLSearchParams(location.search).has('support')) return <main className="app"><nav>{(['Dashboard','Support Inbox','Investigations','Integrations','Settings'] as SupportPage[]).map(item=><button key={item} onClick={()=>setPage(item)}>{item}</button>)}</nav><SupportPlatform page={page} navigate={setPage}/></main>;
 const slow = new URLSearchParams(location.search).has('slow');
 return <main className="app"><InvestigationWorkspace active client={{tool: async options => { await new Promise(resolve => setTimeout(resolve, 250)); return demoClient.tool(options); }}} connected start={async () => { if (!slow) throw new Error('sensitive startup detail'); return 'fixture'; }} analyze={async () => 'Fixture interpretation from the configured analyzer.'} busy={busy} setBusy={setBusy} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
