// Local engine, staged source node, and offline Auth0 responses only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RocketRideClient} from 'rocketride';
import {invokeRead} from '../../src/operations.ts';
import {createSessionTelemetryPipeline,startTelemetryTask} from '../../src/telemetryTask.ts';

const {startServer,stopServer}=createRequire(import.meta.url)('../../../../scripts/lib/server.js');
const repo=path.resolve('../..');
const source=path.join(repo,'nodes/src/nodes/tool_auth0');
const staged=path.join(repo,'dist/server/nodes/tool_auth0');
const files=['IInstance.py','auth0_client.py'];
const original=new Map(), fixture=new Map(), replaced=new Set();
const backup=await mkdtemp(path.join(tmpdir(),'loginlens-auth0-stage-'));
let server,client,token,secondToken;
try {
 for(const file of files) { original.set(file,await readFile(path.join(staged,file))); fixture.set(file,await readFile(path.join(source,file))); await writeFile(path.join(backup,file),original.get(file)); }
 for(const file of files) { await writeFile(path.join(staged,file),fixture.get(file)); replaced.add(file); }
 const pipeline=JSON.parse(await readFile('src/auth0_telemetry.pipe','utf8'));
 pipeline.project_id=randomUUID();
 Object.assign(pipeline.components.find(item=>item.provider==='tool_auth0').config,{domain:'loginlens-fixture.auth0.com',clientId:'fixture-client',clientSecret:'fixture-secret'});
 const started=await startServer({script:'ai/eaas.py',basePort:42500,env:{ROCKETRIDE_MOCK:path.resolve('test/runtime/auth0-mock'),ROCKETRIDE_MOCK_SUBMITTED_EMAIL:'1',UV_OFFLINE:'1',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost',RR_SUBPROCESS_ENV:'HTTPS_PROXY,NO_PROXY,UV_OFFLINE'}});
 server=started.server;
 client=new RocketRideClient({uri:started.uri,auth:process.env.ROCKETRIDE_APIKEY || 'MYAPIKEY'});
 await client.connect();
 const firstSession=createSessionTelemetryPipeline(pipeline), secondSession=createSessionTelemetryPipeline(pipeline);
 token=await startTelemetryTask(client,firstSession);
 assert.equal(await startTelemetryTask(client,firstSession),token);
 secondToken=await startTelemetryTask(client,secondSession);
 assert.notEqual(secondToken,token);
 const exact=await invokeRead(client,token,'get_users_by_email',{email:'person@example.com'});
 assert.equal(exact.status,'success'); assert.equal(exact.data.count,1); assert.equal(exact.data.users[0].user_id,'auth0|fixture-0');
 const logs=await invokeRead(client,token,'search_submitted_email_logs',{email:'person@example.com',start:'2026-01-01T11:00:00.000Z',end:'2026-01-01T13:00:00.000Z'});
 assert.equal(logs.status,'success'); assert.equal(logs.data.count,1); assert.equal(logs.data.rejected,1); assert.equal(logs.data.events[0].type,'fu');
 assert.doesNotMatch(JSON.stringify(logs.data),/other@example|192\.0\.2/);
 const older=await invokeRead(client,token,'search_submitted_email_logs',{email:'person@example.com',start:'2026-01-01T11:00:00.000Z',end:'2026-01-01T13:00:00.000Z',page:1});
 assert.equal(older.status,'success'); assert.equal(older.data.page,1); assert.equal(older.data.events[0].type,'fp');
 const blocks=await invokeRead(client,token,'get_blocks_by_email',{email:'person@example.com'});
 assert.equal(blocks.status,'success'); assert.equal(blocks.data.has_blocks,true); assert.equal(blocks.data.block_count,1);
 assert.doesNotMatch(JSON.stringify(blocks.data),/person@example|192\.0\.2/);
 const accountLogs=await invokeRead(client,token,'get_user_logs',{user_id:'auth0|fixture-0',limit:2});
 assert.equal(accountLogs.status,'success'); assert.equal(accountLogs.data.count,2);
 const oversized=await invokeRead(client,token,'get_user_logs',{user_id:'auth0|fixture-0',limit:1});
 assert.equal(oversized.status,'error'); assert.equal(oversized.error,'API_ERROR'); assert.equal(oversized.data,undefined);
 const tenantLogs=await invokeRead(client,token,'search_logs',{event_type:'fp',limit:2});
 assert.equal(tenantLogs.status,'success'); assert.equal(tenantLogs.data.count,2);
 const oversizedTenant=await invokeRead(client,token,'search_logs',{event_type:'fp',limit:1});
 assert.equal(oversizedTenant.status,'error'); assert.equal(oversizedTenant.error,'API_ERROR'); assert.equal(oversizedTenant.data,undefined);
 for(const tool of ['list_users','list_applications']) {
  const valid=await invokeRead(client,token,tool,{limit:2});
  assert.equal(valid.status,'success'); assert.equal(valid.data.count,2);
  const tooMany=await invokeRead(client,token,tool,{limit:1});
  assert.equal(tooMany.status,'error'); assert.equal(tooMany.error,'API_ERROR'); assert.equal(tooMany.data,undefined);
 }
 console.log('Submitted-email checks passed through the local engine and SDK with fictional Auth0 responses.');
} finally {
 try {
  if(token) await client.terminate(token).catch(()=>{});
  if(secondToken) await client.terminate(secondToken).catch(()=>{});
  if(client) await client.disconnect().catch(()=>{});
  if(server) await stopServer({server});
 } finally {
  for(const file of replaced) {
   const current=await readFile(path.join(staged,file));
   if(!current.equals(fixture.get(file))) throw new Error(`Staged ${file} changed during the test; original remains in ${backup}.`);
   await writeFile(path.join(staged,file),original.get(file));
  }
  if(path.dirname(path.resolve(backup)) !== path.resolve(tmpdir()) || !path.basename(backup).startsWith('loginlens-auth0-stage-')) throw new Error('Unexpected temporary backup location.');
  await rm(backup,{recursive:true,force:true});
 }
}
