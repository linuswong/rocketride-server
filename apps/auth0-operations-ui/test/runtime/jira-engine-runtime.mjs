// Local engine and offline transport fixture only; no Atlassian connection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {cp, mkdir, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RocketRideClient} from 'rocketride';

const {startServer,stopServer}=createRequire(import.meta.url)('../../../../scripts/lib/server.js');
const pipeline=JSON.parse(await readFile('../../nodes/src/nodes/tool_jira_service_management/example.pipe','utf8'));
pipeline.project_id=randomUUID();
const repo=path.resolve('../..');
const source=path.join(repo,'nodes/src/nodes/tool_jira_service_management');
const staged=path.join(repo,'dist/server/nodes/tool_jira_service_management');
let server,client,token,serverOutput='',createdStage=false;
try {
 // Never replace a node already staged by another developer or process.
 await mkdir(staged);
 createdStage=true;
 await cp(source,staged,{recursive:true,errorOnExist:true,force:false});
 const started=await startServer({script:'ai/eaas.py',basePort:42000,onOutput:text=>{serverOutput+=text;},env:{ROCKETRIDE_MOCK:path.resolve('test/runtime/jira-mock'),ROCKETRIDE_JIRA_DOMAIN:'fixture.atlassian.net',ROCKETRIDE_JIRA_CLOUD_ID:'11223344-a1b2-3b33-c444-def123456789',ROCKETRIDE_JIRA_ACCESS_TOKEN:'fixture-token',UV_OFFLINE:'1',HTTPS_PROXY:'http://127.0.0.1:9',https_proxy:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',RR_SUBPROCESS_ENV:'HTTPS_PROXY,NO_PROXY,UV_OFFLINE'}});
 server=started.server;
 client=new RocketRideClient({uri:started.uri,auth:process.env.ROCKETRIDE_APIKEY || 'MYAPIKEY'});
 await client.connect();
 const catalog=await client.getServices();
 const listing=catalog.services?.tool_jira_service_management;
 assert.equal(listing?.protocol,'tool_jira_service_management://');
 assert.ok(listing.classType.includes('tool'));
 const definition=await client.getService('tool_jira_service_management');
 assert.equal(definition.protocol,'tool_jira_service_management://');
 assert.ok(definition.classType.includes('tool'));
 token=(await client.use({pipeline,useExisting:false,ttl:300,pipelineTraceLevel:'none'})).token;
 const invoke=(tool,input)=>client.tool({token,tool,nodeId:'tool_jira_service_management_1',input});
 const selected=await invoke('get_request',{issue_key:'SUP-1',include_summary:true});
 assert.equal(selected.success,true); assert.equal(selected.request.summary,'Cannot sign in');
 assert.doesNotMatch(JSON.stringify(selected),/private-description/);
 const list=await invoke('list_requests',{});
 assert.equal(list.success,true); assert.equal(list.requests[0].issue_key,'SUP-1'); assert.equal(list.last_page,true);
 assert.equal(list.start,0); assert.equal(list.limit,20); assert.equal(list.size,1);
 const limited=await invoke('get_request',{issue_key:'SUP-2'});
 assert.equal(limited.error_code,'RATE_LIMITED'); assert.equal(limited.retry_after_seconds,15);
 assert.doesNotMatch(JSON.stringify(limited),/do not expose/);
 const mismatch=await invoke('get_request',{issue_key:'SUP-3',include_summary:true});
 assert.equal(mismatch.success,false); assert.equal(mismatch.error_code,'INVALID_RESPONSE');
 assert.doesNotMatch(JSON.stringify(mismatch),/private-mismatch/);
 const invalidPage=await invoke('list_requests',{start:20,limit:20});
 assert.equal(invalidPage.success,false); assert.equal(invalidPage.error_code,'INVALID_RESPONSE');
 assert.doesNotMatch(JSON.stringify(invalidPage),/private-pagination/);
 const invalidInput=await invoke('get_request',{issue_key:'../other'});
 assert.equal(invalidInput.success,false); assert.equal(invalidInput.error_code,'INVALID_INPUT');

 console.log('Jira node appeared in local RocketRide service discovery and executed using only offline fixture responses.');
} catch (error) {
 const categories=[...new Set(serverOutput.match(/\b[A-Za-z]+(?:Error|Exception)\b/g) ?? [])];
 console.error('Engine startup categories:',categories.join(', ') || 'none captured', '; output length:',serverOutput.length);
 const errorLine=serverOutput.split(/\r?\n/).find(line=>line.includes('RuntimeError:')) ?? '';
 const terms=['startup','port','bind','server','service','timeout','permission','failed','configuration','license','node','engine','ready','version lookup','seed','database','sql','command','dependency'].filter(term=>errorLine.toLowerCase().includes(term));
 console.error('Engine error terms:',terms.join(', ') || 'none');
 const frames=[...serverOutput.matchAll(/File "([^"\r\n]+)", line (\d+)/g)].map(match=>`${path.basename(match[1])}:${match[2]}`);
 console.error('Engine stack frames:',[...new Set(frames)].join(', ') || 'none');
 throw error;
} finally {
 try {
  if(token) await client.terminate(token).catch(()=>{});
  if(client) await client.disconnect().catch(()=>{});
  if(server) await stopServer({server});
 } finally {
  if(createdStage) await rm(staged,{recursive:true,force:true});
 }
}
