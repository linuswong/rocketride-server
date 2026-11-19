import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigation, executeInvestigation, findings, validateTarget} from '../src/investigation.ts';
import {demoClient, demoTarget, demoAnalysis} from '../src/offlineDemo.ts';
import {invokeRead, retrieveEvidence} from '../src/operations.ts';
const ok = data => ({success:true,...data});
const base = {search_users:ok({users:[{user_id:'auth0|1',email:'a@example.com',secret:'hidden'}],count:1}),get_user:ok({user_id:'auth0|1',blocked:false,connections:[]}),get_user_logs:ok({events:[{log_id:'e1',date:null,type:'f',description:'Failure'}],count:1}),get_user_blocks:ok({has_blocks:false,block_count:0,blocks:[]})};
const step = (r,id) => r.steps.find(s=>s.id===id);
async function run(overrides={}, analyze=async e => `Review ${e[2].tool}`) { const calls=[]; const states=[]; const client={async tool(o){calls.push(o.tool); return {...base,...overrides}[o.tool];}}; const result=await executeInvestigation(createInvestigation('a@example.com'),client,'token',analyze,r=>states.push(r)); return {result,calls,states}; }
test('successful account investigation collects verified evidence and records state transitions',async()=>{const {result,calls,states}=await run(); assert.deepEqual(calls,['search_users','get_user','get_user_logs','get_user_blocks']); assert.equal(step(result,'report').state,'completed'); assert.match(result.diagnosis,/get_user_logs/); assert.equal(step(result,'search').evidence.data.users[0].secret,undefined); for(const id of ['search','profile','logs','blocks','aggregate','diagnosis','report']) assert.ok(states.some(s=>step(s,id).state==='running'));});
test('zero and multiple matches stop account checks',async()=>{for(const users of [[],[{user_id:'1',email:'a@example.com'},{user_id:'2',email:'a@example.com'}]]){const {result,calls}=await run({search_users:ok({users,count:users.length})}); assert.deepEqual(calls,['search_users']); assert.equal(step(result,'match').state,'warning'); assert.equal(step(result,'logs').state,'skipped'); assert.equal(step(result,'not-found').state,users.length?'skipped':'warning');}});
test('active blocks are findings rather than execution failures; empty logs warn',async()=>{const {result}=await run({get_user_blocks:ok({has_blocks:true,block_count:1,blocks:[{identifier:'redacted',connection:null}]}),get_user_logs:ok({events:[],count:0})}); assert.equal(step(result,'blocks').state,'completed'); assert.match(step(result,'blocks').summary,/Block records/); assert.equal(step(result,'logs').state,'warning'); assert.equal(step(result,'aggregate').state,'warning');});
test('errors and malformed responses remain visible and partial evidence survives',async()=>{for(const bad of [undefined, {success:true,events:[],count:2}, {success:false,error_code:'RATE_LIMITED',retry_after_seconds:4}]){const {result}=await run({get_user_logs:bad}); assert.equal(step(result,'logs').state,'failed'); assert.equal(step(result,'blocks').state,'completed'); assert.equal(step(result,'aggregate').state,'warning'); if(bad?.error_code) assert.match(step(result,'logs').summary,/4 seconds/);}});
test('search and profile failures prevent dependent calls',async()=>{for(const overrides of [{search_users:{success:false,error_code:'MISSING_SCOPE'}},{get_user:{success:true,user_id:'different',blocked:false,connections:[]}}]){const {result,calls}=await run(overrides); assert.ok(!calls.includes('get_user_logs')); assert.equal(step(result,'logs').state,'skipped');}});
test('independent checks overlap after profile completion',async()=>{let release; const gate=new Promise(resolve=>release=resolve); let started=[]; const client={async tool({tool}){started.push(tool); if(tool==='get_user_logs'||tool==='get_user_blocks') await gate; return base[tool];}}; const pending=executeInvestigation(createInvestigation('a@example.com'),client,'token',async()=> 'review',()=>{}); await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(started,['search_users','get_user','get_user_logs','get_user_blocks']); release(); await pending;});
test('analysis failure preserves evidence and marks report incomplete',async()=>{const {result}=await run({},async()=>{throw Error('Model unavailable')}); assert.equal(step(result,'diagnosis').state,'failed'); assert.equal(step(result,'report').state,'warning'); assert.equal(step(result,'blocks').state,'completed');});
test('validates input and supports a direct user ID without email search',async()=>{assert.ok(validateTarget('bad input')); assert.ok(validateTarget('x@example.com\nother')); assert.equal(validateTarget('auth0|1'),undefined); const calls=[]; const client={async tool({tool}){calls.push(tool);return base[tool]}}; const result=await executeInvestigation(createInvestigation('auth0|1'),client,'token',async()=> 'review',()=>{}); assert.deepEqual(calls,['get_user','get_user_logs','get_user_blocks']); assert.equal(step(result,'search').state,'skipped');});
test('evidence findings keep administrative and brute force blocks separate and link to their source',async()=>{const {result}=await run({get_user:ok({user_id:'auth0|1',blocked:true,connections:[]}),get_user_logs:ok({events:[],count:0})}); const items=findings(result); assert.ok(items.some(f=>f.source==='profile'&&f.category==='confirmed'&&/administrative/.test(f.text))); assert.ok(items.some(f=>f.source==='blocks'&&f.category==='not observed')); assert.ok(items.some(f=>f.source==='logs'&&f.category==='inconclusive'));});
test('specific Auth0 event findings are grounded in returned types',async()=>{const {result}=await run({get_user_logs:ok({events:[{log_id:'1',date:null,type:'fp',description:'Failure'},{log_id:'2',date:null,type:'fu',description:'Failure'}],count:2})}); const items=findings(result).filter(f=>f.source==='logs'); assert.ok(items.some(f=>/fp \(incorrect-password\)/.test(f.text))); assert.ok(items.some(f=>/fu \(unknown-user\)/.test(f.text))); const empty=await run({get_user_logs:ok({events:[],count:0})}); assert.ok(!findings(empty.result).some(f=>/incorrect-password|unknown-user/.test(f.text)));});
test('offline example exercises real orchestration without external services',async()=>{const result=await executeInvestigation(createInvestigation(demoTarget),demoClient,'offline',demoAnalysis,()=>{}); assert.equal(step(result,'report').state,'completed'); assert.match(result.diagnosis,/Synthetic/); assert.equal(findings(result).find(f=>f.source==='logs').category,'confirmed');});
test('timeouts and thrown SDK errors do not expose sensitive exception text',async()=>{const timeout=await invokeRead({tool:()=>new Promise(()=>{})},'token','get_user',{},5); assert.match(timeout.error,/timed out/); const failed=await invokeRead({tool:async()=>{throw Error('secret access token')}},'token','get_user',{}); assert.doesNotMatch(failed.error,/secret|token/);});
test('AI analysis may be skipped while preserving evidence',async()=>{const result=await executeInvestigation(createInvestigation(demoTarget),demoClient,'offline',undefined,()=>{}); assert.equal(step(result,'diagnosis').state,'skipped'); assert.equal(step(result,'blocks').state,'completed');});
test('mismatched profile is not treated as confirmed account evidence',async()=>{const {result}=await run({get_user:ok({user_id:'different',blocked:true,connections:[]})}); assert.equal(step(result,'profile').state,'failed'); assert.deepEqual(findings(result).filter(f=>f.source==='profile').map(f=>f.category),['inconclusive']);});
test('chat retrieval stops before further account reads on identity mismatch',async()=>{for(const responses of [{...base,search_users:ok({users:[{user_id:'auth0|1',email:'other@example.com'}],count:1})},{...base,get_user:ok({user_id:'wrong',blocked:false,connections:[]})}]){const calls=[];await retrieveEvidence({tool:async({tool})=>{calls.push(tool);return responses[tool]}},'token',{email:'a@example.com'});assert.equal(calls.includes('get_user_logs'),false);}});

test('workspace view separates execution from diagnostic severity and handles unknown states', async () => {
 const {stepView, createInvestigation} = await import('../src/investigation.ts');
 const steps = createInvestigation('alex@example.com').steps;
 const profile = steps.find(s=>s.id==='profile');
 assert.equal(stepView(profile).execution, 'pending');
 const blocked = {...profile,state:'completed',evidence:{tool:'get_user',status:'success',data:{blocked:true}}};
 assert.equal(stepView(blocked).execution, 'completed');
 assert.equal(stepView(blocked).severity, 'warning');
 assert.equal(stepView({...profile,state:'warning'}).execution, 'completed');
 assert.equal(stepView({...profile,state:'unexpected'}).execution, 'unknown');
 assert.deepEqual(steps.find(s=>s.id==='logs').dependencies, ['profile']);
 assert.deepEqual(steps.find(s=>s.id==='blocks').dependencies, ['profile']);
 assert.deepEqual(steps.find(s=>s.id==='aggregate').dependencies, ['logs','blocks']);
});

test('workspace evidence discards sensitive fields and redacts secrets in allowed text', async () => {
 const {safeEvidence} = await import('../src/investigation.ts');
 const safe = safeEvidence({tool:'get_user_logs',status:'success',input:{user_id:'auth0|demo',authorization:'Bearer hidden'},data:{success:true,count:1,token:'hidden',events:[{type:'f',description:'password=hunter2 Bearer abc123',secret:'hidden'}]}});
 const encoded = JSON.stringify(safe);
 assert.doesNotMatch(encoded, /hunter2|abc123|hidden/);
 assert.match(encoded, /redacted/);
 assert.equal(safe.input.user_id, 'auth0|demo');
});
