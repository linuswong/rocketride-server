/* global process, console, structuredClone */
// One isolated engine, actual Auth0 and model nodes, fictional offline transports only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, readdir, mkdtemp, rm, cp, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RocketRideClient, Question, QuestionType} from 'rocketride';
import {execute, recommendedAction} from '../../src/lensPlan.ts';
import {agentCandidates, runInvestigationAgent} from '../../src/investigationAgent.ts';
import {plannerAnswer, supportsBoundedGemini} from '../../src/plannerResponse.ts';

const require=createRequire(import.meta.url);
const {startServer,stopServer}=require('../../../../scripts/lib/server.js');
const temporary=await mkdtemp(path.join(tmpdir(),'loginlens-full-'));
await cp('test/runtime/mock/google',path.join(temporary,'google'),{recursive:true,filter:source=>!source.includes('__pycache__')});
await copyFile('test/runtime/auth0-mock/requests.py',path.join(temporary,'requests.py'));
const auth=JSON.parse(await readFile('src/auth0_telemetry.pipe','utf8'));
Object.assign(auth.components.find(item=>item.provider==='tool_auth0').config,{domain:'loginlens-fixture.auth0.com',clientId:'fixture-client',clientSecret:'fixture-secret'});
auth.project_id=randomUUID();
const planner=JSON.parse(await readFile('src/planner.pipe','utf8'));
planner.components.find(item=>item.provider==='llm_gemini').config['models-gemini-3-1-flash-lite'].apikey='LOGINLENS_MOCK_ONLY';
const end=Date.parse('2026-11-19T20:00:00Z');
const events=Array.from({length:18},(_,i)=>({id:`fixture-event-${i}`,time:Date.parse(`2026-11-19T19:59:${String(50-i).padStart(2,'0')}.000Z`),kind:'failure',category:'Wrong password',source:i<8?1:2+Math.floor((i-8)/2)}));
const context={id:'fixture',rule:'Fictional failures',severity:'High',explanation:'Fixture',limitation:'Fictional',events,start:end-3600000,end};
const plan=[{id:'event',tool:'get_log_event',purpose:'Verify event',depends:[],ref:'E1'},{id:'source-analysis',tool:'analyze_source_groups',purpose:'Compare source',depends:[]},{id:'source-accounts',tool:'investigate_source_accounts',purpose:'Check accounts',depends:['source-analysis']}];
let server,client,authToken; const tasks=new Set();
try {
 const started=await startServer({script:'ai/eaas.py',basePort:41500,env:{ROCKETRIDE_MOCK:temporary,ROCKETRIDE_MOCK_AUDIT_DIR:temporary,ROCKETRIDE_MOCK_BLOCKED_ACCOUNT:'1',ROCKETRIDE_MOCK_RATE_AFTER_TWO:'1',ROCKETRIDE_MOCK_PARTIAL_HISTORY:'1',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost',RR_SUBPROCESS_ENV:'HTTPS_PROXY,NO_PROXY'}});
 server=started.server;
 client=new RocketRideClient({uri:started.uri,auth:process.env.ROCKETRIDE_APIKEY || 'MYAPIKEY'});
 await client.connect();
 assert.ok(supportsBoundedGemini(await client.getService('llm_gemini')));
 authToken=(await client.use({pipeline:auth,useExisting:false,ttl:300,pipelineTraceLevel:'none'})).token;
 const results=await execute(plan,context,client,authToken,()=>{});
 const accounts=results['source-accounts'].accountEvidence;
 assert.equal(results['source-analysis'].facts.selectedFailures,18);
 assert.equal(results['source-analysis'].facts.largestGroup,8);
 assert.equal(results['source-analysis'].facts.sourceGroups,6);
 assert.equal(results['source-analysis'].facts.aclRangeMatches,1);
 assert.equal(results['source-analysis'].facts.aclCoverage,'retrieved');
 assert.equal(accounts.matched,8);
 assert.equal(accounts.ja3Reported,8);assert.equal(accounts.ja3Groups,1);assert.equal(accounts.ja3LargestGroup,8);
 assert.equal(accounts.ja4Reported,8);assert.equal(accounts.ja4Groups,1);assert.equal(accounts.ja4LargestGroup,8);
 assert.equal(accounts.accounts.length,4);
 assert.ok(accounts.accounts.every(item=>item.selectedFailures===2 && item.sameSourceRecentFailures===2));
 assert.ok(accounts.accounts.every(item=>item.directFailureTypes.wrongPassword===2 && item.directFailureTypes.unknownUser===0));
 assert.equal(accounts.accounts.filter(item=>item.blocked).length,1);
 let round=0;
 const model=async(instructions,payload,update)=>{
  const data=JSON.stringify(payload);
  assert.doesNotMatch(data,/fixture-event|auth0\|fixture|192\.0\.2/);
  assert.ok(!data.includes('0'.repeat(32)));
  assert.ok(!data.includes('t13d1516h2_8daaf6152771_b186095e22b6'));
  assert.equal(payload.evidence.observations.find(item=>item.id==='source-accounts').accounts.repeated,4);
  assert.ok(payload.evidence.observations.find(item=>item.id==='source-accounts').accounts.items.every(item=>item.directFailureTypes.wrongPassword===2));
  assert.equal(payload.evidence.observations.find(item=>item.id==='source-accounts').accounts.blocked,1);
  const pipeline=structuredClone(planner);pipeline.project_id=randomUUID();
  const task=await client.use({pipeline,useExisting:false,ttl:300,pipelineTraceLevel:'none'});tasks.add(task.token);
  try {
   const question=new Question({type:QuestionType.PROMPT,expectJson:false});
   question.addQuestion(`${instructions}\nData: ${data}\n${['MOCK_AGENT_AUTH0_1','MOCK_AGENT_AUTH0_2','MOCK_AGENT_AUTH0_CONCLUDE'][round++]}`);
   return plannerAnswer(await client.chat({token:task.token,question}),update);
  } finally {await client.terminate(task.token);tasks.delete(task.token);}
 };
 const outcome=await runInvestigationAgent({context,plan,results,model,update:()=>{},perform:(next,previous)=>execute(next,context,client,authToken,()=>{},()=>true,30000,undefined,previous)});
 assert.equal(outcome.status,'concluded');assert.equal(outcome.requests,3);
 assert.deepEqual(outcome.recommendation.references,['source-accounts','event']);
 assert.match(outcome.recommendation.action,/remove the confirmed administrative block/);
 assert.match(outcome.recommendation.uncertainty,/may not explain every failure/);
 assert.equal(outcome.results['followup-1'].state,'success');assert.equal(outcome.results['followup-2'].state,'success');
 const noBlockContext={...context,events:events.slice(8,10)};
 const noBlockResults=await execute(plan,noBlockContext,client,authToken,()=>{});
 assert.equal(noBlockResults['source-accounts'].accountEvidence.accounts.filter(item=>item.blocked).length,0);
 let correctionRound=0;
 const noBlockModel=async(instructions,payload,update)=>{
  const data=JSON.stringify(payload);
  assert.doesNotMatch(data,/fixture-event|auth0\|fixture|192\.0\.2/);
  assert.equal(payload.evidence.observations.find(item=>item.id==='source-accounts').accounts.blocked,0);
  if(correctionRound===1) assert.match(payload.feedback,/not supported/);
  const pipeline=structuredClone(planner);pipeline.project_id=randomUUID();
  const task=await client.use({pipeline,useExisting:false,ttl:300,pipelineTraceLevel:'none'});tasks.add(task.token);
  try {
   const question=new Question({type:QuestionType.PROMPT,expectJson:false});
   question.addQuestion(`${instructions}\nData: ${data}\n${['MOCK_AGENT_HALLUCINATED_BLOCK','MOCK_AGENT_NO_FIX'][correctionRound++]}`);
   return plannerAnswer(await client.chat({token:task.token,question}),update);
  } finally {await client.terminate(task.token);tasks.delete(task.token);}
 };
 const noBlockOutcome=await runInvestigationAgent({context:noBlockContext,plan,results:noBlockResults,model:noBlockModel,update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(noBlockOutcome.status,'concluded');assert.equal(noBlockOutcome.requests,2);
 assert.match(noBlockOutcome.recommendation.action,/cannot determine a fix/);
 const historyPlan=[...plan,{id:'current',tool:'search_authentication_history',purpose:'Inspect current history',depends:[],period:'anomaly'}];
 const partialHistory=await execute(historyPlan,context,client,authToken,()=>{});
 assert.equal(partialHistory.current.state,'partial');
 assert.equal(partialHistory.current.facts.returned,100);
 assert.equal(partialHistory.current.facts.historyError,'RATE_LIMITED',`Partial history: ${JSON.stringify(partialHistory.current.facts)}`);
 assert.equal(partialHistory.current.facts.historyRetryAfterSeconds,47);
 assert.equal(partialHistory['source-accounts'].state,'skipped');
 assert.deepEqual(agentCandidates(context,historyPlan,partialHistory),[]);
 assert.match(recommendedAction(historyPlan,partialHistory).action,/at least 47 seconds/);
 // Use an event not touched by the earlier source-group follow-ups so the
 // mock's read counter starts at zero for this rate-limit scenario.
 const rateContext={...context,events:[{...events[12],id:'fixture-event-18',time:Date.parse('2026-11-19T19:59:32.000Z')}]};
 const rateResults=await execute(plan,rateContext,client,authToken,()=>{});
 assert.equal(rateResults['source-analysis'].facts.aclError,'RATE_LIMITED');
 assert.equal(rateResults['source-analysis'].facts.aclRetryAfterSeconds,31);
 assert.equal(rateResults['source-accounts'].state,'skipped');
 let rateRound=0,followupExecuted=false;
 const rateModel=async(instructions,payload,update)=>{
  assert.deepEqual(payload.candidates,[]);
  if(rateRound===1) assert.match(payload.feedback,/unavailable/);
  const pipeline=structuredClone(planner);pipeline.project_id=randomUUID();
  const task=await client.use({pipeline,useExisting:false,ttl:300,pipelineTraceLevel:'none'});tasks.add(task.token);
  try {
   const question=new Question({type:QuestionType.PROMPT,expectJson:false});
   question.addQuestion(`${instructions}\nData: ${JSON.stringify(payload)}\n${['MOCK_AGENT_RATE_CHECK','MOCK_AGENT_RATE_CONCLUDE'][rateRound++]}`);
   return plannerAnswer(await client.chat({token:task.token,question}),update);
  } finally {await client.terminate(task.token);tasks.delete(task.token);}
 };
 const rateOutcome=await runInvestigationAgent({context:rateContext,plan,results:rateResults,model:rateModel,update:()=>{},perform:async()=>{followupExecuted=true;return rateResults;}});
 assert.equal(rateOutcome.status,'concluded');assert.equal(rateOutcome.requests,2);assert.equal(followupExecuted,false);
 assert.match(rateOutcome.recommendation.action,/rate limit/);
 const audits=await Promise.all((await readdir(temporary)).filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await readFile(path.join(temporary,name),'utf8'))));
 assert.equal(audits.filter(item=>item.kind==='attempt').length,7);
 console.log('Full isolated engine: eight of 18 failures correlated to four accounts; unsupported unblock and rate-limit bypass attempts were rejected; partial history retained its Auth0 rate limit.');
} finally {
 if (client) {for(const token of tasks) await client.terminate(token).catch(()=>{});if(authToken) await client.terminate(authToken).catch(()=>{});await client.disconnect().catch(()=>{});}
 if(server) await stopServer({server});
 const resolved=path.resolve(temporary),prefix=path.resolve(tmpdir())+path.sep;
 if(resolved.startsWith(prefix) && path.basename(resolved).startsWith('loginlens-full-')) await rm(resolved,{recursive:true,force:true});
}
