import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateSourceAccounts, investigateAccountHistoryPage, retryableRateDelay } from '../src/sourceInvestigation.ts';

const now = Date.parse('2026-11-23T10:00:00Z');
const events = Array.from({length:8}, (_, i) => ({id:`e${i}`,time:now-i*1000,kind:'failure',category:'Wrong password',app:'Example',source:1}));
const timestamp = event => new Date(event.time).toISOString();

test('reports only aggregate verified-source fingerprint counts', async () => {
 const ja3a='a'.repeat(32),ja3b='b'.repeat(32),ja4a='t13d1516h2_8daaf6152771_b186095e22b6',ja4b='q13d1516h3_8daaf6152771_b186095e22b6';
 const client={async tool({tool,input}) {
  if (tool==='get_log_event') {
   const event=events.find(item=>item.id===input.log_id),i=events.indexOf(event);
   assert.equal(input.include_fingerprint,true);
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:i===7?'192.0.2.11':'192.0.2.10',user_id:'auth0|one',client_name:i<3?'private-client-a':i<5?'private-client-b':i===6?'invalid\nname':null,client_id:i<3?'private-id-a':i<5?'private-id-b':i===6?'invalid id':null,ja3:i<4?ja3a:i<6?ja3b:null,ja4:i<3?ja4a:i<5?ja4b:i===6?'invalid':null};
  }
  if (tool==='get_user') return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if (tool==='get_user_logs') return {success:true,events:[],count:0};
  if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  if (tool==='get_application_config') return {success:true,client_id:input.client_id,app_type:'spa',token_endpoint_auth_method:'none',authorization_code_enabled:true,password_enabled:false,refresh_token_enabled:true,client_credentials_enabled:false};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.matched,7);assert.equal(result.ja3Reported,6);assert.equal(result.ja3Groups,2);assert.equal(result.ja3LargestGroup,4);
 assert.equal(result.ja4FieldReturned,7);assert.equal(result.ja4Reported,5);assert.equal(result.ja4Groups,2);assert.equal(result.ja4LargestGroup,3);
 assert.deepEqual(result.reportedApplications,[{name:'private-client-a',count:3},{name:'private-client-b',count:2}]);assert.equal(result.missingApplication,2);
 assert.deepEqual(result.accounts[0].reportedApplications,result.reportedApplications);
 assert.deepEqual(result.reportedApplicationIds,[{id:'private-id-a',count:3},{id:'private-id-b',count:2}]);assert.equal(result.missingApplicationId,2);
 assert.deepEqual(result.accounts[0].reportedApplicationIds,result.reportedApplicationIds);
 assert.equal(result.applicationConfigs.length,2);assert.ok(result.applicationConfigs.every(config=>config.status==='verified' && config.appType==='spa' && config.password===false));assert.equal(result.applicationConfigUnchecked,0);
 assert.doesNotMatch(JSON.stringify(result),new RegExp([ja3a,ja3b,ja4a,ja4b].join('|')));
});

test('reports missing application permission without losing account correlation',async()=>{
 let configCalls=0;
 const client={async tool({tool,input}) {
  if(tool==='get_log_event') {const event=events.find(item=>item.id===input.log_id),index=events.indexOf(event);return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one',client_id:index<4?'client-one':'client-two'};}
  if(tool==='get_user')return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if(tool==='get_user_logs')return {success:true,events:[],count:0};
  if(tool==='get_user_blocks')return {success:true,has_blocks:false,block_count:0,blocks:[]};
  if(tool==='get_application_config'){configCalls++;return {success:false,error_code:'MISSING_SCOPE'};}
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.accounts[0].profile,'verified');assert.equal(result.matched,8);assert.equal(configCalls,1);
 assert.equal(result.applicationConfigs[0].error,'MISSING_SCOPE');assert.equal(result.applicationConfigUnchecked,1);
});
test('compares later successes by source and application without assuming the device',async()=>{
 for (const [correctAccount,source,successApp,expectedSource,expectedApp] of [[true,'192.0.2.10','app-one',true,true],[true,'192.0.2.11','app-two',false,false],[true,null,null,null,null],[false,'192.0.2.10','app-one',null,null]]) {
  const laterDate=new Date(now+1000).toISOString();
  const client={async tool({tool,input}) {
   if(tool==='get_log_event' && input.log_id==='later-success') {assert.equal(input.include_source,true);assert.equal(input.include_application,true);return {success:true,log_id:'later-success',date:laterDate,type:'s',user_id:correctAccount?'auth0|one':'auth0|other',source_ip:source,client_id:successApp};}
   if(tool==='get_log_event') {const event=events.find(item=>item.id===input.log_id);return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one',client_id:'app-one'};}
   if(tool==='get_user')return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
   if(tool==='get_user_logs')return {success:true,events:[{log_id:'later-success',date:laterDate,type:'s',description:'Fictional success'}],count:1};
   if(tool==='get_user_blocks')return {success:true,has_blocks:false,block_count:0,blocks:[]};
   if(tool==='get_application_config')return {success:true,client_id:input.client_id,app_type:'spa',token_endpoint_auth_method:'none',authorization_code_enabled:true,password_enabled:false,refresh_token_enabled:true,client_credentials_enabled:false};
   throw Error('Unexpected call');
  }};
  const result=await investigateSourceAccounts(events.slice(0,2),'192.0.2.10',client,'fixture',()=>{});
  assert.equal(result.accounts[0].successAfterSelected,correctAccount?'verified':'unverified');
  assert.equal(result.accounts[0].successAfterSelectedSameSource,expectedSource);assert.equal(result.accounts[0].successAfterSelectedSameApplication,expectedApp);
 }
});
test('keeps a verified later success when its application option is unsupported',async()=>{
 const laterDate=new Date(now+1000).toISOString(),reads=[];
 const client={async tool({tool,input}) {
  if(tool==='get_log_event' && input.log_id==='later-success') {reads.push(input);if(input.include_application)return {success:false,error_code:'INVALID_INPUT'};return {success:true,log_id:'later-success',date:laterDate,type:'s',user_id:'auth0|one',source_ip:'192.0.2.10'};}
  if(tool==='get_log_event') {const event=events.find(item=>item.id===input.log_id);return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one',client_id:'app-one'};}
  if(tool==='get_user')return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if(tool==='get_user_logs')return {success:true,events:[{log_id:'later-success',date:laterDate,type:'s',description:'Fictional success'}],count:1};
  if(tool==='get_user_blocks')return {success:true,has_blocks:false,block_count:0,blocks:[]};
  if(tool==='get_application_config')return {success:true,client_id:input.client_id,app_type:'spa',token_endpoint_auth_method:'none',authorization_code_enabled:true,password_enabled:false,refresh_token_enabled:true,client_credentials_enabled:false};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events.slice(0,2),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(reads.length,2);assert.equal(result.accounts[0].successAfterSelected,'verified');assert.equal(result.accounts[0].successAfterSelectedSameSource,true);assert.equal(result.accounts[0].successAfterSelectedSameApplication,null);
});
test('does not pick an application when equally recent failures have different IDs',async()=>{
 const selected=events.slice(0,2).map(event=>({...event,time:now})),laterDate=new Date(now+1000).toISOString();
 const client={async tool({tool,input}) {
  if(tool==='get_log_event' && input.log_id==='later-success')return {success:true,log_id:'later-success',date:laterDate,type:'s',user_id:'auth0|one',source_ip:'192.0.2.10',client_id:'app-one'};
  if(tool==='get_log_event')return {success:true,log_id:input.log_id,date:new Date(now).toISOString(),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one',client_id:input.log_id==='e0'?'app-one':'app-two'};
  if(tool==='get_user')return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if(tool==='get_user_logs')return {success:true,events:[{log_id:'later-success',date:laterDate,type:'s',description:'Fictional success'}],count:1};
  if(tool==='get_user_blocks')return {success:true,has_blocks:false,block_count:0,blocks:[]};
  if(tool==='get_application_config')return {success:true,client_id:input.client_id,app_type:'spa',token_endpoint_auth_method:'none',authorization_code_enabled:true,password_enabled:false,refresh_token_enabled:true,client_credentials_enabled:false};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(selected,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.accounts[0].successAfterSelected,'verified');assert.equal(result.accounts[0].successAfterSelectedSameApplication,null);
});
test('tries distinct later-success candidates in order, stopping after three',async()=>{
 for (const validIndex of [3,4]) {
  const reads=[];
  const rows=Array.from({length:4},(_,i)=>({log_id:`later-${i+1}`,date:new Date(now+4000-i*1000).toISOString(),type:'s',description:'Fictional success'}));
  const client={async tool({tool,input}) {
   if(tool==='get_log_event' && String(input.log_id).startsWith('later-')) {reads.push(input.log_id);const row=rows.find(item=>item.log_id===input.log_id);return {success:true,...row,user_id:input.log_id===`later-${validIndex}`?'auth0|one':'auth0|other'};}
   if(tool==='get_log_event') {const event=events.find(item=>item.id===input.log_id);return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one'};}
   if(tool==='get_user')return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
   if(tool==='get_user_logs')return {success:true,events:rows,count:rows.length};
   if(tool==='get_user_blocks')return {success:true,has_blocks:false,block_count:0,blocks:[]};
   throw Error('Unexpected call');
  }};
  const result=await investigateSourceAccounts(events.slice(0,2),'192.0.2.10',client,'fixture',()=>{});
  assert.deepEqual(reads,['later-1','later-2','later-3']);
  assert.equal(result.accounts[0].successAfterSelected,validIndex===3?'verified':'unverified');
 }
});
test('a rate limit during later-success verification stops the remaining reads',async()=>{
 const reads=[],rows=[1,2].map(i=>({log_id:`later-${i}`,date:new Date(now+(3-i)*1000).toISOString(),type:'s',description:'Fictional success'}));
 const client={async tool({tool,input}) {
  if(tool==='get_log_event' && String(input.log_id).startsWith('later-')) {reads.push(input.log_id);return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:31};}
  if(tool==='get_log_event') {const event=events.find(item=>item.id===input.log_id);return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one'};}
  if(tool==='get_user')return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if(tool==='get_user_logs')return {success:true,events:rows,count:rows.length};
  if(tool==='get_user_blocks')return {success:true,has_blocks:false,block_count:0,blocks:[]};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events.slice(0,2),'192.0.2.10',client,'fixture',()=>{});
 assert.deepEqual(reads,['later-1']);assert.equal(result.accounts[0].successAfterSelected,'unverified');
 assert.equal(result.accountStopReason,'RATE_LIMITED');assert.equal(result.accountRetryAfterSeconds,31);
});
test('retains fingerprints when an older node rejects only the application ID option',async()=>{
 const client={async tool({tool,input}) {
  if(tool==='get_log_event') {if(input.include_application)return {success:false,error_code:'INVALID_INPUT'};const event=events.find(item=>item.id===input.log_id);return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one',ja3:'a'.repeat(32)};}
  if(tool==='get_user')return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if(tool==='get_user_logs')return {success:true,events:[],count:0};
  if(tool==='get_user_blocks')return {success:true,has_blocks:false,block_count:0,blocks:[]};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.matched,8);assert.equal(result.applicationFallbacks,4);assert.equal(result.fingerprintFallbacks,0);assert.equal(result.ja3Reported,8);assert.equal(result.missingApplicationId,8);
});
test('continues account correlation when an older node rejects the fingerprint option', async () => {
 const calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if (tool==='get_log_event') {
   if (input.include_fingerprint) return {success:false,error_code:'INVALID_INPUT'};
   const event=events.find(item=>item.id===input.log_id);
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one'};
  }
  if (tool==='get_user') return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if (tool==='get_user_logs') return {success:true,events:[],count:0};
  if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.matched,8);assert.equal(result.fingerprintFallbacks,4);assert.equal(result.applicationFallbacks,4);assert.equal(result.ja3Reported,0);assert.equal(result.ja4FieldReturned,0);
 assert.equal(calls.filter(call=>call.tool==='get_log_event' && call.input.include_fingerprint).length,8);
 assert.equal(calls.filter(call=>call.tool==='get_log_event' && !call.input.include_fingerprint).length,8);
});

test('does not retry an unsupported fingerprint option through a shared rate limit', async () => {
 let calls=0;
 const client={async tool({input}) {
  calls++;
  return input.log_id==='e0' ? {success:false,error_code:'INVALID_INPUT'} : {success:false,error_code:'RATE_LIMITED',retry_after_seconds:31};
 }};
 const result=await investigateSourceAccounts(events.slice(0,2),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(calls,2);assert.equal(result.fingerprintFallbacks,0);assert.equal(result.eventStopReason,'RATE_LIMITED');
});

test('a bad event does not disable fingerprints for later valid events', async () => {
 const fingerprint='a'.repeat(32),calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if (tool==='get_log_event') {
   if (input.log_id==='e0') return {success:false,error_code:'INVALID_INPUT'};
   const event=events.find(item=>item.id===input.log_id);
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one',ja3:fingerprint};
  }
  if (tool==='get_user') return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if (tool==='get_user_logs') return {success:true,events:[],count:0};
  if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.failedEvents,1);assert.equal(result.matched,7);
 assert.equal(result.fingerprintFallbacks,0);assert.equal(result.ja3Reported,7);
 assert.equal(calls.filter(call=>call.tool==='get_log_event' && call.input.log_id==='e0').length,3);
 assert.ok(calls.filter(call=>call.tool==='get_log_event' && call.input.log_id!=='e0').every(call=>call.input.include_fingerprint===true));
});

test('a shared profile failure stops further account and recent-detail reads', async () => {
 const calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if (tool==='get_log_event' && input.include_identity_hint) {
   const event=events.find(item=>item.id===input.log_id);
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:`auth0|${event.id}`};
  }
  if (tool==='get_user' && input.user_id==='auth0|e0') return {success:false,error_code:'RATE_LIMITED',retry_after_seconds:47};
  if (tool==='get_user') return {success:true,user_id:input.user_id,blocked:false,connections:[]};
  if (tool==='get_user_logs') return {success:true,events:[{log_id:'recent',date:timestamp(events[0]),type:'fp',description:'Failure'}],count:1};
  if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  throw Error('Unexpected read after shared failure');
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.matched,8); assert.equal(result.accountStopReason,'RATE_LIMITED'); assert.equal(result.accountRetryAfterSeconds,47);
 assert.ok(calls.filter(call=>call.tool==='get_user').length<=4);
 assert.equal(calls.filter(call=>call.tool==='get_log_event' && !call.input.include_identity_hint).length,0);
 assert.ok(result.accounts.some(account=>account.profileError==='RATE_LIMITED'));
});

test('older history stops after a persistent rate limit and keeps verified evidence', async () => {
 const rows=Array.from({length:12},(_,i)=>({log_id:`older-${i}`,date:new Date(now-i*1000).toISOString(),type:'fp',description:'Wrong password'}));
 const account={userId:'auth0|one',profile:'verified'};
 for (const persistent of [false,true]) {
  const calls=[];
  const client={async tool({tool,input}) {
   if (tool==='get_user_logs') return {success:true,events:rows,count:rows.length};
   calls.push(input.log_id);
   if (input.log_id==='older-1' && (persistent || calls.filter(id=>id==='older-1').length===1)) return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:0.001};
   const row=rows.find(item=>item.log_id===input.log_id);
   return {success:true,...row,user_id:'auth0|one',source_ip:'192.0.2.10'};
  }};
  const page=await investigateAccountHistoryPage(account,'192.0.2.10',1,[],client,'fixture');
  assert.equal(page.rateRetries,1);
  if (persistent) {
   assert.equal(page.stopReason,'RATE_LIMITED'); assert.equal(page.retryAfterSeconds,0.001);
   assert.equal(page.matchingSource,3); assert.equal(page.unavailable,1); assert.equal(page.unchecked,8);
   assert.equal(calls.length,5);
  } else {
   assert.equal(page.stopReason,undefined); assert.equal(page.matchingSource,12); assert.equal(page.unchecked,0);
  }
 }
});

test('older history retries its page read once and preserves a persistent retry interval', async () => {
 for (const persistent of [false,true]) {
  let calls=0;
  const client={async tool() {
   calls++;
   if (persistent || calls===1) return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:0.001};
   return {success:true,events:[],count:0};
  }};
  if (persistent) {
   await assert.rejects(investigateAccountHistoryPage({userId:'auth0|one',profile:'verified'},'192.0.2.10',1,[],client,'fixture'),error=>error.message.startsWith('RATE_LIMITED') && error.retryAfterSeconds===0.001);
  } else {
   assert.equal((await investigateAccountHistoryPage({userId:'auth0|one',profile:'verified'},'192.0.2.10',1,[],client,'fixture')).returned,0);
  }
  assert.equal(calls,2);
 }
});

test('reports fixed error categories for selected event reads without inventing account evidence', async () => {
 const client={async tool({input}) {
  if (input.log_id==='e0') return {success:false,error_code:'MISSING_SCOPE'};
  if (input.log_id==='e1') return {success:false,error_code:'RATE_LIMITED',retry_after_seconds:10};
  return {success:true,log_id:'mismatch',date:timestamp(events[2]),type:'fp',source_ip:'192.0.2.10'};
 }};
 const result=await investigateSourceAccounts(events.slice(0,3),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.failedEvents,3);
 assert.deepEqual(result.eventErrors,{MISSING_SCOPE:1,RATE_LIMITED:1});
 assert.equal(result.accounts.length,0);
});

test('does not retry temporary failures when the same batch has a rate limit or missing permission', async () => {
 const calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if (tool==='get_log_event') {
   const event=events.find(item=>item.id===input.log_id);
   if (event.id==='e1') return {success:false,error_code:'MISSING_SCOPE'};
   if (event.id==='e2') return {success:false,error_code:'RATE_LIMITED',retry_after_seconds:10};
   if (calls.filter(call=>call.tool==='get_log_event' && call.input.log_id===event.id).length===1) return {success:false,error_code:'AUTH0_UNAVAILABLE'};
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one'};
  }
  if (tool==='get_user') return {success:true,user_id:input.user_id,blocked:false,connections:[]};
  if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  if (tool==='get_user_logs') return {success:true,events:[],count:0};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events.slice(0,3),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.eventRetries,0); assert.equal(result.eventRetryResponsesSucceeded,0);
 assert.equal(result.matched,0); assert.equal(result.accounts.length,0);
 assert.deepEqual(result.eventErrors,{AUTH0_UNAVAILABLE:1,MISSING_SCOPE:1,RATE_LIMITED:1});
 assert.equal(calls.filter(call=>call.tool==='get_log_event').length,3);
});

test('retries a temporary event failure when the batch has no conflicting stop', async () => {
 let attempts=0;
 const result=await investigateSourceAccounts(events.slice(0,1),'192.0.2.10',{async tool({tool}) {
  if (tool==='get_log_event') return ++attempts===1 ? {success:false,error_code:'AUTH0_UNAVAILABLE'} : {success:true,log_id:'e0',date:timestamp(events[0]),type:'fp',source_ip:'192.0.2.10',user_id:'auth0|one'};
  if (tool==='get_user') return {success:true,user_id:'auth0|one',blocked:false,connections:[]};
  if (tool==='get_user_logs') return {success:true,events:[],count:0};
  if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  throw Error('Unexpected call');
 }},'fixture',()=>{});
 assert.equal(attempts,2); assert.equal(result.eventRetryResponsesSucceeded,1); assert.equal(result.matched,1);
});

test('stops after one unsuccessful temporary event retry', async () => {
 let attempts=0;
 const result=await investigateSourceAccounts(events.slice(0,1),'192.0.2.10',{async tool(){attempts++; return {success:false,error_code:'AUTH0_UNAVAILABLE'};}},'fixture',()=>{});
 assert.equal(attempts,2);
 assert.equal(result.eventRetries,1);
 assert.equal(result.eventRetryResponsesSucceeded,0);
 assert.deepEqual(result.eventErrors,{AUTH0_UNAVAILABLE:1});
 assert.equal(result.failedEvents,1);
});

test('stops selected-event reads after a long rate limit without scheduling the remaining events',async()=>{
 const calls=[];
 const client={async tool({tool,input}) {calls.push({tool,input});return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:31};}};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(calls.length,4);
 assert.equal(result.checked,4);assert.equal(result.unchecked,4);
 assert.equal(result.eventStopReason,'RATE_LIMITED');assert.equal(result.eventRateRetries,0);
 assert.equal(result.eventRetryAfterSeconds,31);
 assert.deepEqual(result.eventErrors,{RATE_LIMITED:4});
});

test('automatic rate-limit retry accepts up to thirty seconds and rejects unsafe or incomplete intervals',()=>{
 const limited=(seconds,retryable=true)=>({tool:'get_log_event',status:'error',error:'RATE_LIMITED',retryable,retryAfterSeconds:seconds});
 assert.equal(retryableRateDelay([limited(30),limited(12)]),30);
 assert.equal(retryableRateDelay([limited(31)]),undefined);
 assert.equal(retryableRateDelay([limited(-1)]),undefined);
 assert.equal(retryableRateDelay([limited(Number.NaN)]),undefined);
 assert.equal(retryableRateDelay([limited(1,false)]),undefined);
 assert.equal(retryableRateDelay([limited(1),{tool:'get_log_event',status:'error',error:'MISSING_SCOPE'}]),undefined);
});

test('retains successful event IDs but does not start account reads after a shared rate limit',async()=>{
 const calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if(tool!=='get_log_event') throw Error('Account reads must not start after a rate limit');
  const event=events.find(item=>item.id===input.log_id);
  if(event.id==='e1') return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:31};
  return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:`auth0|${event.id}`};
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(calls.length,4);assert.equal(result.matched,3);assert.equal(result.unchecked,4);
 assert.equal(result.eventStopReason,'RATE_LIMITED');
 assert.equal(result.accounts.length,3);
 assert.ok(result.accounts.every(account=>account.profile==='failed' && account.profileError==='RATE_LIMITED' && account.logs==='skipped'));
});

test('a rate limit takes priority over a simultaneous missing-scope error',async()=>{
 const calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});if(tool!=='get_log_event') throw Error('No dependent reads after rate limit');
  const event=events.find(item=>item.id===input.log_id);
  if(event.id==='e0') return {success:false,error_code:'MISSING_SCOPE'};
  if(event.id==='e1') return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:31};
  return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:`auth0|${event.id}`};
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.eventStopReason,'RATE_LIMITED');assert.equal(calls.length,4);
 assert.deepEqual(result.eventErrors,{MISSING_SCOPE:1,RATE_LIMITED:1});
});

test('continues account checks for verified events when only a log permission is missing',async()=>{
 const calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if(tool==='get_log_event') {
   const event=events.find(item=>item.id===input.log_id);
   if(event.id==='e1') return {success:false,error_code:'MISSING_SCOPE'};
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:`auth0|${event.id}`};
  }
  if(tool==='get_user') return {success:true,user_id:input.user_id,blocked:false,connections:[]};
  if(tool==='get_user_logs') return {success:true,events:[],count:0};
  if(tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.eventStopReason,'MISSING_SCOPE');assert.equal(result.unchecked,4);
 assert.equal(result.accounts.filter(account=>account.profile==='verified').length,3);
 assert.equal(calls.filter(call=>call.tool==='get_user').length,3);
});

test('retries a short selected-event rate limit then completes the group',async()=>{
 const calls=[];
 const client={async tool({input}) {
  calls.push(input.log_id);const event=events.find(item=>item.id===input.log_id);
  if(event.id==='e0' && calls.filter(id=>id==='e0').length===1) return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:0.001};
  return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:null};
 }};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(calls.length,9);assert.equal(result.eventRateRetries,1);
 assert.equal(result.checked,8);assert.equal(result.matched,8);assert.equal(result.unchecked,0);
 assert.equal(result.eventStopReason,undefined);
});

test('does not repeatedly retry a persistent selected-event rate limit',async()=>{
 let calls=0;
 const client={async tool(){calls++;return {success:false,error_code:'RATE_LIMITED',retryable:true,retry_after_seconds:0.001};}};
 const result=await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(calls,8);assert.equal(result.eventRateRetries,4);
 assert.equal(result.checked,4);assert.equal(result.unchecked,4);assert.equal(result.eventStopReason,'RATE_LIMITED');
});

function manyRecentClient(rateLimited=false, selectedEvents=events) {
 const detailCalls=[];
 return {detailCalls,async tool({tool,input}) {
  if(tool==='get_log_event' && input.include_identity_hint) {
   const event=selectedEvents.find(item=>item.id===input.log_id);
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:`auth0|${event.id}`};
  }
  if(tool==='get_user') return {success:true,user_id:input.user_id,blocked:false,connections:[]};
  if(tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  if(tool==='get_user_logs') {
   const rows=Array.from({length:20},(_,index)=>({log_id:`recent-${input.user_id}-${index}`,date:new Date(now-86400000-index*1000).toISOString(),type:'fp',description:'Wrong password'}));
   return {success:true,events:rows,count:rows.length};
  }
  if(tool==='get_log_event') {
   detailCalls.push(input.log_id);
   if(rateLimited==='always' || (rateLimited && detailCalls.length===1)) return {success:false,error_code:'RATE_LIMITED',retryable:rateLimited==='once' || rateLimited==='always',retry_after_seconds:rateLimited==='once' || rateLimited==='always' ? 0.001 : 30};
   const match=String(input.log_id).match(/^recent-(auth0\|e\d+)-(\d+)$/);
   return {success:true,log_id:input.log_id,date:new Date(now-86400000-Number(match[2])*1000).toISOString(),type:'fp',source_ip:'192.0.2.10',user_id:match[1]};
  }
  throw Error('Unexpected call');
 }};
}

test('automatically verifies all returned recent failures across accounts, including beyond forty',async()=>{
 const client=manyRecentClient();
 const result=await investigateSourceAccounts(events.slice(0,3),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(client.detailCalls.length,60);
 assert.ok(result.accounts.every(account=>account.sameSourceRecentFailures===20 && account.recentDetailsUnchecked===0));
 assert.equal(result.detailBudgetReached,false);
});

test('checks the bounded first page for all twenty accounts',async()=>{
 const selected=Array.from({length:20},(_,index)=>({...events[0],id:`e${index}`,time:now-index*1000}));
 const client=manyRecentClient(false,selected);
 const result=await investigateSourceAccounts(selected,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(client.detailCalls.length,400);
 assert.equal(result.accounts.length,20);
 assert.ok(result.accounts.every(account=>account.sameSourceRecentFailures===20 && account.recentDetailsUnchecked===0));
 assert.equal(result.detailBudgetReached,false);
});

test('stops issuing recent-detail reads after a rate limit and reports unchecked counts per account',async()=>{
 const client=manyRecentClient(true);
 const result=await investigateSourceAccounts(events.slice(0,3),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(client.detailCalls.length,4);
 assert.equal(result.detailStopReason,'RATE_LIMITED');
 assert.equal(result.detailRetryAfterSeconds,30);
 assert.equal(result.detailBudgetReached,true);
 assert.deepEqual(result.accounts.map(account=>account.recentDetailsUnchecked),[16,20,20]);
 assert.equal(result.accounts[0].recentDetailsFailed,1);
});

test('waits for a short rate limit and retries the affected recent detail once',async()=>{
 const client=manyRecentClient('once');
 const result=await investigateSourceAccounts(events.slice(0,3),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(client.detailCalls.length,61);
 assert.equal(result.detailRateRetries,1);
 assert.equal(result.detailBudgetReached,false);
 assert.ok(result.accounts.every(account=>account.sameSourceRecentFailures===20 && account.recentDetailsUnchecked===0));
});

test('does not repeatedly retry a persistent rate limit',async()=>{
 const client=manyRecentClient('always');
 const result=await investigateSourceAccounts(events.slice(0,3),'192.0.2.10',client,'fixture',()=>{});
 assert.equal(client.detailCalls.length,8);
 assert.equal(result.detailRateRetries,4);
 assert.equal(result.detailStopReason,'RATE_LIMITED');
 assert.equal(result.accounts.reduce((sum,account)=>sum+account.recentDetailsUnchecked,0),56);
});

test('does not retry after the selected evidence changes during a rate-limit wait',async()=>{
 const client=manyRecentClient('once'); let active=true;
 const result=await investigateSourceAccounts(events.slice(0,3),'192.0.2.10',client,'fixture',message=>{if(message.startsWith('Auth0 rate limit:')) active=false;},()=>active);
 assert.equal(client.detailCalls.length,4);
 assert.equal(result.detailRateRetries,0);
 assert.equal(result.detailStopReason,'CANCELLED');
});

test('automatically follows eight source failures to account profiles, blocks and recent source repetition', async () => {
 const requests = [], progress = [];
 const client = {async tool({tool,input}) {
  requests.push({tool,input});
  if (tool === 'get_log_event') {
   const event = events.find(item=>item.id===input.log_id);
   return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:event.id==='e7' ? null : event.id==='e6' ? 'auth0|other' : 'auth0|one'};
  }
  if (tool === 'get_user') return {success:true,user_id:input.user_id,blocked:false,connections:[]};
  if (tool === 'get_user_blocks') return {success:true,has_blocks:input.user_id==='auth0|other',block_count:input.user_id==='auth0|other'?1:0,blocks:input.user_id==='auth0|other'?[{}]:[]};
  if (tool === 'get_user_logs') {
   const rows = events.filter(event => input.user_id === 'auth0|one' ? !['e6','e7'].includes(event.id) : event.id==='e6').map(event=>({log_id:event.id,date:timestamp(event),type:'fp',description:'Wrong password'}));
   return {success:true,events:rows,count:rows.length};
  }
  throw Error('Unexpected tool');
 }};
 const result = await investigateSourceAccounts(events,'192.0.2.10',client,'fixture',message=>progress.push(message));
 assert.deepEqual([result.selected,result.checked,result.matched,result.missingIdentity,result.failedEvents], [8,8,8,1,0]);
 assert.deepEqual(result.accounts.map(account=>[account.userId,account.selectedFailures,account.sameSourceRecentFailures,account.bruteForceBlocked]), [['auth0|one',6,6,false],['auth0|other',1,1,true]]);
 assert.ok(progress.some(message=>message.includes('recent failed events')));
 assert.equal(requests.filter(call=>call.tool==='get_user').length,2);
});

test('does not follow unverified identities or count a different source as repetition', async () => {
 const rows=events.slice(0,3), calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if (tool==='get_log_event') { const event=rows.find(row=>row.id===input.log_id); return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:event.id==='e1'?'192.0.2.11':'192.0.2.10',user_id:event.id==='e2'?null:'auth0|one'}; }
  if (tool==='get_user') return {success:true,user_id:'auth0|mismatch',blocked:false,connections:[]};
  throw Error('Unexpected dependent call');
 }};
 const result=await investigateSourceAccounts(rows,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.differentSource,1); assert.equal(result.missingIdentity,1);
 assert.equal(result.accounts[0].profile,'mismatch');
 assert.equal(calls.filter(call=>['get_user_logs','get_user_blocks'].includes(call.tool)).length,0);
});

test('reports omitted identifiers and request limits instead of claiming complete evidence', async () => {
 const many=Array.from({length:51},(_,i)=>({...events[0],id:`large${i}`}));
 const calls=[];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if (tool==='get_log_event') return {success:true,log_id:input.log_id,date:timestamp(many[0]),type:'fp',source_ip:'192.0.2.10',user_id:null};
  throw Error('Unidentified accounts must not be queried');
 }};
 const result=await investigateSourceAccounts(many,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.selected,51); assert.equal(result.checked,50); assert.equal(result.unchecked,1);
 assert.equal(result.missingIdentity,50); assert.equal(result.accounts.length,0);
 assert.equal(calls.length,50);
});

test('follows a unique exact-email hint while leaving ambiguous and non-email identifiers unresolved', async () => {
 const rows=events.slice(0,4), calls=[];
 const hints=['one@example.com','one@example.com','shared@example.com','not-an-email'];
 const client={async tool({tool,input}) {
  calls.push({tool,input});
  if (tool==='get_log_event') { const index=rows.findIndex(row=>row.id===input.log_id); const event=rows[index]; return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:null,user_name:hints[index]}; }
  if (tool==='search_users') return input.email==='one@example.com' ? {success:true,users:[{user_id:'auth0|one',email:'one@example.com'}],count:1} : {success:true,users:[{user_id:'auth0|a',email:input.email},{user_id:'auth0|b',email:input.email}],count:2};
  if (tool==='get_user') return {success:true,user_id:input.user_id,email:'one@example.com',blocked:false,connections:[]};
  if (tool==='get_user_blocks') return {success:true,has_blocks:false,block_count:0,blocks:[]};
  if (tool==='get_user_logs') return {success:true,events:[],count:0};
  throw Error('Unexpected call');
 }};
 const result=await investigateSourceAccounts(rows,'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.emailHintResolved,2); assert.equal(result.missingIdentity,2);
 assert.deepEqual(result.unresolvedIdentifiers.map(item=>item.identifier).sort(),['not-an-email','shared@example.com']);
 assert.equal(result.accounts.length,1); assert.equal(result.accounts[0].directFailures,0); assert.equal(result.accounts[0].emailHintFailures,2);
 assert.deepEqual(result.accounts[0].directFailureTypes,{failedLogin:0,wrongPassword:0,unknownUser:0});
 assert.equal(calls.filter(call=>call.tool==='search_users').length,2);
 assert.equal(calls.filter(call=>call.tool==='get_user').length,1);
});

test('counts repeated submitted usernames without claiming an account match', async () => {
 const rows=events.slice(0,3);
 const client={async tool({input}) { const event=rows.find(row=>row.id===input.log_id); return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:null,user_name:'service-user'}; }};
 const result=await investigateSourceAccounts(rows,'192.0.2.10',client,'fixture',()=>{});
 assert.deepEqual(result.unresolvedIdentifiers,[{identifier:'service-user',count:3,reason:'Username is not an email; no exact account lookup is available.'}]);
 assert.equal(result.accounts.length,0); assert.equal(result.missingIdentity,3);
});

test('does not follow a candidate whose current profile no longer matches the email hint', async () => {
 const event=events[0], calls=[];
 const client={async tool({tool,input}) {
  calls.push(tool);
  if (tool==='get_log_event') return {success:true,log_id:event.id,date:timestamp(event),type:'fp',source_ip:'192.0.2.10',user_id:null,user_name:'old@example.com'};
  if (tool==='search_users') return {success:true,users:[{user_id:'auth0|one',email:'old@example.com'}],count:1};
  if (tool==='get_user') return {success:true,user_id:input.user_id,email:'new@example.com',blocked:false,connections:[]};
  throw Error('Dependent reads must not run');
 }};
 const result=await investigateSourceAccounts([event],'192.0.2.10',client,'fixture',()=>{});
 assert.equal(result.accounts[0].profile,'mismatch');
 assert.ok(!calls.includes('get_user_logs')); assert.ok(!calls.includes('get_user_blocks'));
});
