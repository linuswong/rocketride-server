/* global URL, structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSessionTelemetryPipeline, startTelemetryTask, verifyTelemetryPipeline } from '../src/telemetryTask.ts';

const pipeline=JSON.parse(await readFile(new URL('../src/auth0_telemetry.pipe',import.meta.url),'utf8'));
test('each app session gets a distinct project while preserving the read-only pipeline',()=>{
 const first=createSessionTelemetryPipeline(pipeline), second=createSessionTelemetryPipeline(pipeline);
 assert.notEqual(first.project_id,pipeline.project_id); assert.notEqual(second.project_id,first.project_id);
 assert.deepEqual(first.components,pipeline.components); verifyTelemetryPipeline(first,first.project_id);
});
test('refresh and expired replacement use only a verified read-only Auth0 task without model credentials',async()=>{
 let launches=0, providerCalls=0;
 const fakeProvider=()=>{providerCalls++;throw Error('AI provider was invoked');};
 const client={
  use:async options=>{ launches++; assert.equal(options.useExisting,true); assert.deepEqual(options.pipeline.components.map(c=>c.provider),['tools','tool_auth0']); if(options.pipeline.components.some(c=>c.provider.startsWith('llm_'))) fakeProvider(); return {token:`task-${launches}`}; },
  getTaskPipeline:async()=>structuredClone(pipeline),
 };
 assert.equal(await startTelemetryTask(client,pipeline),'task-1');
 assert.equal(await startTelemetryTask(client,pipeline),'task-2');
 assert.equal(launches,2); assert.equal(providerCalls,0);
 assert.doesNotMatch(JSON.stringify(pipeline),/GEMINI|OPENROUTER|llm_|agent_/i);
});
test('rejects extra nodes, writes and unverified running tasks before use',async()=>{
 const bad=structuredClone(pipeline); bad.components[1].config.allowWrite=true;
 let calls=0; const client={use:async()=>{calls++;return {token:'t'};},getTaskPipeline:async()=>bad};
 assert.throws(()=>verifyTelemetryPipeline({...pipeline,components:[...pipeline.components,{id:'bad',provider:'llm_gemini'}]},pipeline.project_id));
 await assert.rejects(startTelemetryTask(client,bad)); assert.equal(calls,0);
 await assert.rejects(startTelemetryTask(client,pipeline)); assert.equal(calls,1);
});
test('rejects a reused task with different Auth0 connection settings before any data request',async()=>{
 for(const key of ['domain','clientId','clientSecret','writeClientId','writeClientSecret']) {
  const altered=structuredClone(pipeline); altered.components[1].config[key]='different-fixture-value';
  let dataCalls=0;
  const client={use:async()=>({token:'existing'}),getTaskPipeline:async()=>altered,tool:async()=>{dataCalls++;}};
  await assert.rejects(startTelemetryTask(client,pipeline),/different Auth0 connection settings/);
  assert.equal(dataCalls,0);
 }
});
test('task startup and verification have bounded waits without automatic retry or data reads',async()=>{
 let starts=0,verifications=0,reads=0;
 const slowStart={use:async()=>{starts++;return new Promise(()=>{});},getTaskPipeline:async()=>{verifications++;},tool:async()=>{reads++;}};
 await assert.rejects(startTelemetryTask(slowStart,pipeline,{startMs:5,verifyMs:5}),/may still be starting/);
 assert.equal(starts,1); assert.equal(verifications,0); assert.equal(reads,0);
 const slowVerify={use:async()=>{starts++;return {token:'fixture'};},getTaskPipeline:async()=>{verifications++;return new Promise(()=>{});},tool:async()=>{reads++;}};
 await assert.rejects(startTelemetryTask(slowVerify,pipeline,{startMs:5,verifyMs:5}),/may still be running/);
 assert.equal(starts,2); assert.equal(verifications,1); assert.equal(reads,0);
});
