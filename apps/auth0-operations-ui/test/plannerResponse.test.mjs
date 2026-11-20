/* global URL */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plannerAnswer, parsePlannerResponse, supportsBoundedGemini, PlannerError } from '../src/plannerResponse.ts';
import { manualContext, manualQuestions, propose, validatePlan, plannerExample, plannerInstructions } from '../src/lensPlan.ts';

const time=Date.parse('2026-11-19T20:00:00Z');
const events=[{id:'sensitive-log',time:time-1000,kind:'failure',category:'Wrong password',app:'private'}];
const context=manualContext(events,[events[0].id],time-3600000,time,manualQuestions[0]);
const anomaly={id:'a',rule:'Repeated account failures',severity:'Moderate',explanation:'Repeated failures',limitation:'Insufficient evidence',events,start:time-3600000,end:time};
const plan={steps:[{id:'event',tool:'get_log_event',ref:'E1',purpose:'Verify event',expected:'Event type',depends:[]}]};
const envelope=value=>({result_types:{output:'answers'},output:[{answer:value}]});
const category=(fn,expected)=>assert.throws(fn,error=>error instanceof PlannerError && error.category===expected);

test('documented RocketRide answer envelope and exact JSON fences reach validated graphs',async()=>{
 const text=JSON.stringify(plan);
 for (const answer of [text,'```json\n'+text+'\n```','```\n'+text+'\n```',plan]) {
  const updates=[];
  const result=await propose(context,async(_,__,update)=>plannerAnswer(envelope(answer),update),patch=>updates.push(patch));
  assert.equal(result[0].tool,'get_log_event');
  assert.ok(updates.some(item=>item.schema==='valid'));
  assert.ok(!JSON.stringify(updates).includes('sensitive-log'));
 }
 const anomalyPlan=await propose(anomaly,async()=>text);
 assert.equal(anomalyPlan[0].ref,'E1');
});
test('rejects empty, explanatory, truncated, refusal, provider errors and unsupported envelopes',()=>{
 category(()=>plannerAnswer(envelope('')),'missing_response');
 category(()=>plannerAnswer({result_types:{output:'answers'},output:[]}),'missing_response');
 category(()=>plannerAnswer({status:'error',error:'private provider detail'}),'provider_unavailable');
 category(()=>plannerAnswer(envelope('**LLM error** — ConnectionError: private provider detail')),'provider_unavailable');
 category(()=>plannerAnswer({foo:'bar'}),'unexpected_envelope');
 category(()=>plannerAnswer({result_types:{a:'answers',b:'text'},a:'x',b:'y'}),'unexpected_envelope');
 category(()=>parsePlannerResponse('Here is your plan: {"steps":[]}'),'malformed_json');
 category(()=>parsePlannerResponse('{"steps":['),'possibly_truncated');
 category(()=>parsePlannerResponse('```json\n{}'),'possibly_truncated');
 category(()=>parsePlannerResponse('I cannot assist with this request.'),'model_refusal');
 category(()=>parsePlannerResponse('before ```json\n{}\n``` after'),'malformed_json');
});
test('valid JSON cannot bypass schema, tool allowlist or dependency validation',async()=>{
 for (const [value,expected] of [
  [{steps:[{...plan.steps[0],unexpected:true}]},'invalid_graph'],
  [{steps:[{...plan.steps[0],tool:'delete_user'}]},'invalid_graph'],
  [{steps:[{...plan.steps[0],depends:['missing']}]},'invalid_graph'],
 ]) {
  await assert.rejects(propose(context,async()=>JSON.stringify(value)), error=>error.category===expected);
 }
});

test('planner example matches the enforced model contract', () => {
 assert.equal(validatePlan(plannerExample, context, {requireExpected:true})[0].ref, 'E1');
 assert.ok(plannerInstructions.includes(JSON.stringify(plannerExample)));
 for (const phrase of ['get_log_event', 'search_logs', 'search_authentication_history', 'get_brute_force_settings', 'get_ip_throttling_settings', 'previous_24h', 'at most 4', '1 to 6']) assert.ok(plannerInstructions.includes(phrase));
});

test('model graph diagnostics identify constraints without retaining private response text', async () => {
 const base=plan.steps[0];
 const cases=[
  [{steps:[{...base, tool:'secret-user@example.com'}]}, 'unsupported_tool', '$.steps[0].tool'],
  [{steps:[{...base, input:{log_id:'sensitive-log'}}]}, 'invalid_argument_binding', '$.steps[0]'],
  [{steps:[{...base, ref:'sensitive-log'}]}, 'unknown_event_reference', '$.steps[0].ref'],
  [{steps:[{...base, ref:undefined}]}, 'missing_field', '$.steps[0].ref'],
  [{steps:[{...base, ref:'E21'}]}, 'unknown_event_reference', '$.steps[0].ref'],
  [{steps:[{id:'settings',tool:'get_brute_force_settings',purpose:'Review',expected:'Settings',depends:[]}]}, 'missing_evidence', '$.steps'],
  [{steps:[{...base,depends:['private-missing-id']}]}, 'invalid_dependency', '$.steps[0].depends'],
  [{steps:[{...base,depends:['settings']},{id:'settings',tool:'get_brute_force_settings',purpose:'Review',expected:'Settings',depends:['event']}]}, 'dependency_cycle', '$.steps'],
  [{steps:['secret-user@example.com']}, 'invalid_structure', '$.steps[0]'],
  [{steps:[{...base,expected:undefined}]}, 'missing_field', '$.steps[0].expected'],
  [{steps:[{...base},{id:'history',tool:'search_authentication_history',purpose:'Review',expected:'Counts',depends:[],period:'today'}]}, 'invalid_argument_binding', '$.steps[1].period'],
  [{steps:Array.from({length:5},(_,i)=>({...base,id:'s'+i,tool:i ? 'get_brute_force_settings' : 'get_log_event',ref:i ? undefined : 'E1',depends:i ? ['s'+(i-1)] : []})).map((s,i)=> i ? {...s,tool:['get_brute_force_settings','get_ip_throttling_settings','search_authentication_history','search_logs'][i-1],...(i===3?{period:'anomaly'}:{}),...(i===4?{ref:'E1'}:{})} : s)}, 'maximum_depth', '$.steps'],
 ];
 for (const [graph, category, path] of cases) {
  let diagnostic={}; let calls=0;
  await assert.rejects(propose(context,async()=>{calls++; return JSON.stringify(graph);},patch=>Object.assign(diagnostic,patch)), error=>{
   assert.equal(error.issue.category,category); assert.equal(error.issue.path,path);
   assert.ok(error.issue.expected); assert.ok(error.issue.actual); assert.ok(error.issue.explanation);
   return true;
  });
  assert.equal(calls,1); assert.equal(diagnostic.parse,'valid'); assert.equal(diagnostic.schema,'invalid');
  assert.equal(diagnostic.validation.category,category);
  assert.doesNotMatch(JSON.stringify(diagnostic),/sensitive-log|secret-user@example.com|private-missing-id/);
 }
});

test('planner invokes the model once for malformed responses and provider failures',async()=>{
 for (const failure of ['malformed', new Error('provider failure')]) {
  let calls=0;
  await assert.rejects(propose(context,async()=>{calls++; if (failure instanceof Error) throw failure; return failure;}));
  assert.equal(calls,1);
 }
});

test('planner pipeline has a single bounded LLM and no agent or Auth0 tools',()=>{
 const pipeline=JSON.parse(readFileSync(new URL('../src/planner.pipe',import.meta.url),'utf8'));
 const nodes=pipeline.components;
 assert.deepEqual(nodes.map(node=>node.provider).sort(),['chat','llm_gemini','response_answers'].sort());
 const llm=nodes.find(node=>node.provider==='llm_gemini');
 assert.equal(llm.config.maxProviderAttempts,1);
 assert.deepEqual(llm.input,[{lane:'questions',from:'chat_1'}]);
 assert.deepEqual(nodes.find(node=>node.provider==='response_answers').input,[{lane:'answers',from:llm.id}]);
});

test('the planner fails closed when the engine does not advertise the one-attempt setting',()=>{
 assert.equal(supportsBoundedGemini({Pipe:{schema:{properties:{profile:{type:'string'}}}}}),false);
 assert.equal(supportsBoundedGemini({Pipe:{schema:{properties:{maxProviderAttempts:{type:'integer',minimum:1,maximum:5}}}}}),false);
 assert.equal(supportsBoundedGemini({Pipe:{schema:{properties:{maxProviderAttempts:{type:'integer',minimum:1,maximum:1}}}}}),true);
});
