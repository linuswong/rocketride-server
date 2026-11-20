import test from 'node:test';
import assert from 'node:assert/strict';
import { manualContext, manualQuestions, propose, execute, fixtureTools, findings, validatePlan } from '../src/lensPlan.ts';
import { safeFailure } from '../src/diagnostics.ts';

const end = Date.parse('2026-11-19T20:00:00Z');
const loaded = [
 {id:'private-log-id', time:end-1000, kind:'failure', category:'Wrong password', app:'Private app'},
 {id:'second-id', time:end-2000, kind:'success', category:'Successful login', app:'Private app'},
];
const create = refs => manualContext(loaded, refs, end-3600000, end, manualQuestions[0]);
test('manual selection requires actual distinct loaded references, a supported question, and bounded evidence', () => {
 assert.equal(create(['private-log-id']).events[0],loaded[0]);
 for (const refs of [[], ['unknown'], ['private-log-id','private-log-id']]) assert.throws(()=>create(refs));
 assert.throws(()=>manualContext(loaded,['private-log-id'],end,end+1000,manualQuestions[0]));
 assert.throws(()=>manualContext(loaded,['private-log-id'],end-3600000,end,'injected question'));
});
test('manual model sees sanitized evidence and produces a validated read-only plan with uncertainty', async () => {
 const context=create(['private-log-id','second-id']);
 let calls=0;
 const plan=await propose(context,async (_,data)=>{
  calls++;
  assert.equal(data.context,'manual selection; no anomaly asserted');
  assert.equal(data.question,manualQuestions[0]);
  assert.equal(data.counts.failures,1);
  assert.ok(!JSON.stringify(data).includes('private-log-id'));
  assert.ok(!JSON.stringify(data).includes('Private app'));
  return JSON.stringify({steps:[{id:'event',tool:'get_log_event',ref:'E1',purpose:'Verify the recorded event',expected:'Type and time',depends:[]},{id:'settings',tool:'get_brute_force_settings',purpose:'Review protection',expected:'Current setting',depends:['event']}]});
 });
 assert.equal(calls,1);
 assert.throws(()=>validatePlan({steps:[{...plan[0],ref:'E3'}]},context));
 assert.throws(()=>validatePlan({steps:[{...plan[0],tool:'get_user'}]},context));
 const states=[];
 const results=await execute(plan,context,fixtureTools(context),'fixture',state=>states.push(state));
 assert.ok(states.some(state=>state.event.state==='running'));
 assert.equal(results.event.state,'success');
 const report=await findings(plan,results,undefined,context);
 assert.match(report[0].uncertainty,/cannot establish/);
});
test('manual success events can be verified; missing evidence does not create findings', async () => {
 const context=create(['second-id']);
 const plan=await propose(context);
 const results=await execute(plan,context,fixtureTools(context),'fixture',()=>{});
 assert.equal(results.event.state,'success');
 assert.match((await findings(plan,results))[0].possibleCause,/does not establish/);
 for (const id of Object.keys(results)) results[id]={state:'failed',detail:'unavailable'};
 assert.deepEqual(await findings(plan,results,undefined,context),[]);
});
test('event lookup binds the exact selected ID, and rejects a different ID even with matching type and time', async () => {
 const context=create(['private-log-id']);
 const plan=[{id:'event',tool:'get_log_event',purpose:'Check event',depends:[],ref:'E1'}];
 const inputs=[];
 const results=await execute(plan,context,{tool:async options=>{
  inputs.push(options.input);
  return {success:true,log_id:'other-event-with-same-time',type:'fp',date:new Date(loaded[0].time).toISOString()};
 }},'fixture',()=>{});
 assert.equal(inputs.length,1);
 assert.equal(inputs[0].log_id,loaded[0].id);
 assert.equal(results.event.state,'failed');
 assert.match(results.event.detail,/did not match/);
});
test('safe diagnostics categorize failures without copying exception data', () => {
 const secret='sensitive-identifier';
 assert.match(safeFailure(Object.assign(new Error(secret),{status:429}),'Auth0'),/rate limited/);
 assert.match(safeFailure(Object.assign(new Error(secret),{code:'ECONNRESET'}),'Auth0'),/connection failure/);
 assert.ok(!safeFailure(new Error(secret),'Auth0').includes(secret));
});
