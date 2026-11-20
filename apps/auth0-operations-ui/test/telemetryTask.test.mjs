/* global URL, structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTelemetryTask, verifyTelemetryPipeline } from '../src/telemetryTask.ts';

const pipeline=JSON.parse(await readFile(new URL('../src/auth0_telemetry.pipe',import.meta.url),'utf8'));
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
