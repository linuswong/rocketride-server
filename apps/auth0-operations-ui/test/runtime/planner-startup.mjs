// Fixed-size, fake-transport startup and isolation check; never sends a model request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RocketRideClient } from 'rocketride';

const { startServer, stopServer } = createRequire(import.meta.url)('../../../../scripts/lib/server.js');
const auditDir = await mkdtemp(path.join(tmpdir(), 'loginlens-startup-'));
const pipeline = JSON.parse(await readFile('src/planner.pipe', 'utf8'));
pipeline.components.find(c => c.provider === 'llm_gemini').config['models-gemini-3-1-flash-lite'].apikey = 'LOGINLENS_MOCK_ONLY';
const tasks = new Set();
let server, client;
let diagnosticBuffer = '';
const diagnostics = [];
let attempt = 0, began = 0, ready = false;
try {
 const onOutput = text => {
  diagnosticBuffer += text;
  const lines = diagnosticBuffer.split(/\r?\n/);
  diagnosticBuffer = lines.pop();
  for (const line of lines) {
   const marker = line.indexOf('LOGINLENS_DIAG ');
   if (marker >= 0) { try { diagnostics.push(JSON.parse(line.slice(marker + 'LOGINLENS_DIAG '.length))); } catch {} }
  }
 };
 const started = await startServer({script:path.resolve('test/runtime/diagnostic-engine.py'), basePort:40000, trace:['debugOut'], onOutput, env:{ROCKETRIDE_MOCK:path.resolve('test/runtime/mock'), ROCKETRIDE_MOCK_AUDIT_DIR:auditDir, ROCKETRIDE_GEMINI_KEY:'LOGINLENS_MOCK_ONLY', GOOGLE_GEMINI_BASE_URL:'http://127.0.0.1:9', RR_SUBPROCESS_ENV:'GOOGLE_GEMINI_BASE_URL'}});
 server = started.server;
 client = new RocketRideClient({uri:started.uri,auth:process.env.ROCKETRIDE_APIKEY || 'MYAPIKEY'});
 await client.connect();
 const start = async label => {
  const run = await client.use({pipeline:{...structuredClone(pipeline),project_id:randomUUID()},useExisting:false,ttl:300,pipelineTraceLevel:'none'});
  tasks.add(run.token);
  assert.notEqual(run.reused,true);
  const active = await client.getTaskPipeline(run.token);
  const parts = active.components;
  assert.deepEqual(parts.map(c=>c.provider).sort(),['chat','llm_gemini','response_answers'].sort());
  const models = parts.filter(c=>c.provider==='llm_gemini');
  assert.equal(models.length,1);
  assert.equal(models[0].config.profile,'models-gemini-3-1-flash-lite');
  assert.equal(models[0].config.maxProviderAttempts,1);
  assert.deepEqual(parts.find(c=>c.provider==='llm_gemini').input,[{lane:'questions',from:'chat_1'}]);
  assert.deepEqual(parts.find(c=>c.provider==='response_answers').input,[{lane:'answers',from:'llm_gemini_1'}]);
  const audit = await Promise.all((await readdir(auditDir)).map(async name=>JSON.parse(await readFile(path.join(auditDir,name),'utf8'))));
  assert.equal(audit.filter(e=>e.kind==='attempt').length,0,'startup must not invoke the fake provider');
  assert.ok(audit.filter(e=>e.kind==='client').length<=1,'one Gemini node should create at most one client');
  ready = true;
  return run.token;
 };
 const startupCount = process.argv.includes('--smoke') ? 3 : 20;
 for(let i=1;i<=startupCount;i++) {
  attempt=i; began=Date.now(); ready=false; diagnostics.length=0;
  const token=await start(`bounded-${i}`);
  const startupMs=Date.now()-began;
  await client.terminate(token); tasks.delete(token);
  const active=await client.getTasks();
  assert.ok(!active.some(t=>t.token===token),'terminated task remained active');
  assert.equal(server.rocketrideDiagnostics.exited,false);
  const output = diagnostics.filter(e=>e.event==='child_output');
  console.log(JSON.stringify({task:`bounded-${i}`,outcome:'success',startupMs,ready,cleanup:'completed',events:diagnostics.filter(e=>['spawn','exit'].includes(e.event)),states:[...new Set(diagnostics.filter(e=>e.event==='state').map(e=>e.state))],streams:{stdout:output.filter(e=>e.channel==='stdout').length,stderr:output.filter(e=>e.channel==='stderr').length},errors:output.filter(e=>e.exception||e.fatal_code)}));
  // Remove only test audit records from our own temporary directory.
  for(const name of await readdir(auditDir)) await rm(path.join(auditDir,name));
 }
} catch(error) {
 const tail=(server?.rocketrideDiagnostics?.outputTail ?? []).join('\n');
 const exits=[...tail.matchAll(/Subprocess for task exited with code\s+(-?\d+)/gi)].map(m=>Number(m[1]));
 const audit = await Promise.all((await readdir(auditDir)).map(async name=>JSON.parse(await readFile(path.join(auditDir,name),'utf8'))));
 const remaining = client ? await client.getTasks().catch(()=>null) : null;
 console.log(JSON.stringify({task:`bounded-${attempt}`,outcome:'failure',startupMs:Date.now()-began,ready,category:error?.name,message:error?.message==='Stopped'?'Stopped':'assertion or request failed',engineReachable:Array.isArray(remaining),activeTasks:remaining?.length??null,cleanup:'pending',serverExited:server?.rocketrideDiagnostics?.exited??null,serverExitCode:server?.rocketrideDiagnostics?.code??null,taskExitCodes:exits,mockAttempts:audit.filter(e=>e.kind==='attempt').length,events:diagnostics,errors:[...new Set([...tail.matchAll(/\b(?:ModuleNotFoundError|ImportError|PermissionError|OSError|RuntimeError|TypeError|ValueError|AttributeError|KeyError|TimeoutError|FileNotFoundError|AssertionError)\b/g)].map(m=>m[0]))]}));
 process.exitCode=1;
} finally {
 if(client){for(const token of tasks) await client.terminate(token).catch(()=>{});if(process.exitCode) { const active=await client.getTasks().catch(()=>null); console.log(JSON.stringify({event:'failure_cleanup',completed:Array.isArray(active)&&active.length===0})); } await client.disconnect().catch(()=>{});}
 if(server) await stopServer({server});
 const resolved=path.resolve(auditDir), prefix=path.resolve(tmpdir())+path.sep;
 if(resolved.startsWith(prefix) && path.basename(resolved).startsWith('loginlens-startup-')) await rm(resolved,{recursive:true,force:true});
}
