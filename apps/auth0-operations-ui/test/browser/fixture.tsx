// Isolated test host: no shell, engine, credentials or network integration.
import React, { useState } from 'react';
import { LoginLens, type LensPage } from '../../src/LoginLens';
import { createRoot } from 'react-dom/client';
import { InvestigationWorkspace } from '../../src/InvestigationWorkspace';
import { demoClient } from '../../src/offlineDemo';
import { SupportPlatform, type SupportPage } from '../../src/SupportPlatform';
import '../../src/styles.css';

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
 const [lensPage, setLensPage] = useState<LensPage>(new URLSearchParams(location.search).has('manual') ? 'Analytics' : 'Overview');
 const [events] = useState(() => Array.from({length:4},(_,i)=>({log_id:'mock-'+i,date:new Date(Date.now()-5000-i*1000).toISOString(),type:'fp',description:'Login failed.',account_group:1,source_group:1})));
 if (new URLSearchParams(location.search).has('lensmock') || new URLSearchParams(location.search).has('lensplanner')) {
  const client = {tool: async (options: {tool:string; input:Record<string,unknown>}) => {
   document.documentElement.dataset.fixtureCalls = String(Number(document.documentElement.dataset.fixtureCalls ?? 0) + 1);
   document.documentElement.dataset.fixtureTools = [document.documentElement.dataset.fixtureTools, options.tool].filter(Boolean).join(',');
   if (options.tool === 'list_users') { const users = [{user_id:'fixture-active',last_login:new Date(Date.now()-86400000).toISOString()},{user_id:'fixture-inactive',last_login:new Date(Date.now()-40*86400000).toISOString()},{user_id:'fixture-unknown',last_login:null}]; return {success:true,users,count:users.length}; }
   if (options.tool === 'get_log_event') return {success:true,...events.find(event => event.log_id === options.input.log_id)};
   if (options.tool === 'get_brute_force_settings') return new URLSearchParams(location.search).has('runfail') ? {success:false,error_code:'DENIED'} : {success:true,enabled:true};
   return {success:true,events,count:events.length,pages:1,coverage:'retrieved',reason:null,rejected:0,duplicates:0,retry_after_seconds:null};
  }};
  return <main className="app"><nav>{(['Overview','Analytics','Anomaly Detection','Investigations','Settings'] as LensPage[]).map(item=><button key={item} onClick={()=>setLensPage(item)}>{item}</button>)}</nav><LoginLens page={lensPage} navigate={setLensPage} connected client={client} model={async(instructions)=>{document.documentElement.dataset.modelCalls=String(Number(document.documentElement.dataset.modelCalls ?? 0)+1); return instructions.startsWith('Interpret the supplied investigation') ? JSON.stringify({findings:[{reference:'event',possibleCause:'A stale credential may explain the failure.',uncertainty:'One event cannot establish intent.',nextStep:'Compare the event with the sign-in report.',possibleRemediation:'If verified, use the standard recovery process.'}]}) : new URLSearchParams(location.search).has('runtime') ? await (await fetch('/' + new URLSearchParams(location.search).get('response'))).text() : new URLSearchParams(location.search).has('badplan') ? '{"steps":[' : '```json\n'+JSON.stringify({steps:[{id:'event',tool:'get_log_event',purpose:'Verify event',expected:'Type and time',depends:[],ref:'E1'},...(new URLSearchParams(location.search).has('runfail') ? [{id:'settings',tool:'get_brute_force_settings',purpose:'Check settings',expected:'Settings',depends:[]}] : [])]})+'\n```';}} startData={async()=> 'fixture'}/></main>;
 }
 if (new URLSearchParams(location.search).has('lens')) return <main className="app"><nav>{(['Overview','Analytics','Anomaly Detection','Investigations','Settings'] as LensPage[]).map(item=><button key={item} onClick={()=>setLensPage(item)}>{item}</button>)}</nav><LoginLens page={lensPage} navigate={setLensPage} connected={false} client={null} model={async()=>{throw Error('Offline');}} startData={async()=>{throw Error('Offline');}}/></main>;
 if (new URLSearchParams(location.search).has('support')) return <main className="app"><nav>{(['Dashboard','Support Inbox','Investigations','Integrations','Settings'] as SupportPage[]).map(item=><button key={item} onClick={()=>setPage(item)}>{item}</button>)}</nav><SupportPlatform page={page} navigate={setPage}/></main>;
 const slow = new URLSearchParams(location.search).has('slow');
 return <main className="app"><InvestigationWorkspace active client={{tool: async options => { await new Promise(resolve => setTimeout(resolve, 250)); return demoClient.tool(options); }}} connected start={async () => { if (!slow) throw new Error('sensitive startup detail'); return 'fixture'; }} analyze={async () => 'Fixture interpretation from the configured analyzer.'} busy={busy} setBusy={setBusy} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
