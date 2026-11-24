/* global process, console */
// Run the real Auth0 node through an isolated engine with a network-free requests fixture.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RocketRideClient} from 'rocketride';
import {investigateSourceAccounts} from '../../src/sourceInvestigation.ts';

const require=createRequire(import.meta.url);
const {startServer,stopServer}=require('../../../../scripts/lib/server.js');
const pipeline=JSON.parse(await readFile('src/auth0_telemetry.pipe','utf8'));
pipeline.project_id=randomUUID();
Object.assign(pipeline.components.find(item=>item.provider==='tool_auth0').config,{domain:'loginlens-fixture.auth0.com',clientId:'fixture-client',clientSecret:'fixture-secret'});
const events=Array.from({length:8},(_,i)=>({id:`fixture-event-${i}`,time:Date.parse(`2026-11-19T19:59:${String(50-i).padStart(2,'0')}.000Z`),kind:'failure',category:'Wrong password',source:1}));
let server,client,token;
try {
 const started=await startServer({script:'ai/eaas.py',basePort:41000,env:{ROCKETRIDE_MOCK:path.resolve('test/runtime/auth0-mock'),ROCKETRIDE_MOCK_SCOPE_ONCE:'1',HTTPS_PROXY:'http://127.0.0.1:9',https_proxy:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',RR_SUBPROCESS_ENV:'HTTPS_PROXY,NO_PROXY'}});
 server=started.server;
 client=new RocketRideClient({uri:started.uri,auth:process.env.ROCKETRIDE_APIKEY || 'MYAPIKEY'});
 await client.connect();
 const task=await client.use({pipeline,useExisting:false,ttl:300,pipelineTraceLevel:'none'});
 token=task.token;
 const sample=await client.tool({token,tool:'get_log_event',nodeId:'tool_auth0_1',input:{log_id:'fixture-event-0',include_source:true,include_identity_hint:true}});
 assert.equal(sample.success,true,'node should refresh its token and retry the fictional missing-scope response');
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,token,()=>{});
 assert.equal(result.matched,8);
 assert.equal(result.failedEvents,0);
 assert.equal(result.accounts.length,4);
 assert.ok(result.accounts.every(account=>account.selectedFailures===2 && account.profile==='verified' && account.sameSourceRecentFailures===2 && account.bruteForceBlocked===false));
 console.log('Real Auth0 node: eight fictional failures resolved to four accounts, each with two verified same-source failures.');
} finally {
 if (token) await client.terminate(token).catch(()=>{});
 if (client) await client.disconnect().catch(()=>{});
 if (server) await stopServer({server});
}
