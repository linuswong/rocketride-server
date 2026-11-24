import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {investigateSourceAccounts} from '../../src/sourceInvestigation.ts';
import {agentEvidence} from '../../src/investigationAgent.ts';

for (const legacy of [false,true]) test(`correlates eight failures through the ${legacy?'legacy':'current'} Auth0 dispatcher and client`, {timeout:30000}, async()=>{
 const child=spawn('python',['test/runtime/auth0-dispatch-bridge.py'],{stdio:['pipe','pipe','pipe'],env:{...process.env,LOGINLENS_TEST_LEGACY_NODE:legacy?'1':'0'}});
 const pending=new Map(); let sequence=0, stderr='';
 child.stderr.on('data',data=>{stderr+=data.toString();});
 createInterface({input:child.stdout}).on('line',line=>{
  const response=JSON.parse(line), item=pending.get(response.id);
  if (item) {pending.delete(response.id); item.resolve(response.output);}
 });
 child.on('exit',code=>{for (const item of pending.values()) item.reject(new Error(`Dispatcher bridge exited ${code}: ${stderr}`));pending.clear();});
 const client={tool({tool,input}){return new Promise((resolve,reject)=>{
  const id=++sequence; pending.set(id,{resolve,reject});
  child.stdin.write(JSON.stringify({id,tool,input})+'\n',error=>{if(error){pending.delete(id);reject(error);}});
 });}};
 const events=Array.from({length:8},(_,i)=>({id:`fixture-event-${i}`,time:Date.parse(`2026-11-19T19:59:${String(50-i).padStart(2,'0')}.000Z`),kind:'failure',category:'Wrong password',source:1}));
 try {
  const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
  assert.equal(result.matched,8);
  assert.equal(result.failedEvents,0);
  assert.equal(result.fingerprintFallbacks,legacy?4:0);
  assert.equal(result.ja3Reported,legacy?0:8);
  assert.equal(result.accounts.length,4);
  assert.ok(result.accounts.every(account=>account.selectedFailures===2 && account.profile==='verified' && account.sameSourceRecentFailures===2 && account.bruteForceBlocked===false));
  const context={events,start:events[7].time-1000,end:events[0].time+1000};
  const plan=[{id:'source-accounts',tool:'investigate_source_accounts',depends:[],purpose:'Resolve accounts'}];
  const observation=agentEvidence(context,plan,{'source-accounts':{state:'success',detail:'Verified',accountEvidence:result}}).observations[0];
  assert.equal(observation.accounts.repeated,4);
  assert.ok(observation.accounts.items.every(account=>account.selectedFailures===2 && account.sameSourceRecentFailures===2));
  assert.doesNotMatch(JSON.stringify(observation),/auth0\|fixture|192\.0\.2\.10/);
 } finally {child.stdin.end();}
});
