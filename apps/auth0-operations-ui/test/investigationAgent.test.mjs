import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, fixtureTools, fullInvestigationPlan, recommendedAction } from '../src/lensPlan.ts';
import { agentCandidates, agentEvidence, MAX_AGENT_REQUESTS, runInvestigationAgent } from '../src/investigationAgent.ts';

const now=Date.parse('2026-11-23T12:00:00Z');
const events=Array.from({length:8},(_,i)=>({id:`private-log-${i}`,time:now-(i+1)*1000,kind:'failure',category:i===2?'Unknown user':'Wrong password',app:'private-app',account:i+1,source:i<4?1:2}));
const context={id:'a',rule:'Possible password spraying',severity:'High',explanation:'Example',limitation:'Fixture',events,start:now-3600000,end:now};

async function initial() {
 const plan=fullInvestigationPlan(context), fixture=fixtureTools(context), calls=[];
 const client={async tool(input){calls.push(input);return fixture.tool(input);}};
 const results=await execute(plan,context,client,'fixture',()=>{});
 return {plan,results,client,calls};
}

test('a shared failure in older history stops further agent reads and remains visible', async()=>{
 const {plan,results}=await initial();
 const step={id:'followup-1',tool:'investigate_account_history',purpose:'Older history',depends:['source-accounts'],sourceRef:'source-accounts',accountIndex:0,historyPage:1};
 const historyEvidence={page:1,returned:20,failures:20,verified:3,matchingSource:3,duplicates:0,unavailable:1,unchecked:16,pageFull:true,verifiedEventIds:['private-log-older'],stopReason:'RATE_LIMITED',retryAfterSeconds:45,rateRetries:0};
 const nextPlan=[...plan,step], nextResults={...results,'followup-1':{state:'partial',detail:'Older page',facts:{matchingSource:3,unchecked:16},historyEvidence}};
 assert.deepEqual(agentCandidates(context,nextPlan,nextResults),[]);
 const observation=agentEvidence(context,nextPlan,nextResults).observations.find(item=>item.id==='followup-1');
 assert.equal(observation.historyStop,'RATE_LIMITED'); assert.equal(observation.historyRetryAfterSeconds,45); assert.equal(observation.facts.unchecked,16);
 assert.doesNotMatch(JSON.stringify(observation),/private-log-older/);
 assert.match(recommendedAction(nextPlan,nextResults).action,/at least 45 seconds/);
});
test('a rate-limited partial tenant history stops agent follow-ups and exposes its coverage', async()=>{
 const {plan,results}=await initial();
 const nextResults={...results,current:{...results.current,state:'partial',facts:{...results.current.facts,coverage:'partial',historyError:'RATE_LIMITED',historyRetryAfterSeconds:45}}};
 assert.deepEqual(agentCandidates(context,plan,nextResults),[]);
 const observation=agentEvidence(context,plan,nextResults).observations.find(item=>item.id==='current');
 assert.equal(observation.coverage,'partial'); assert.equal(observation.historyError,'RATE_LIMITED'); assert.equal(observation.historyRetryAfterSeconds,45);
});
test('an account-stage rate limit stops agent follow-ups and preserves its retry interval', async()=>{
 const {plan,results}=await initial(), source=results['source-accounts'].accountEvidence;
 const nextResults={...results,'source-accounts':{...results['source-accounts'],state:'partial',accountEvidence:{...source,accountStopReason:'RATE_LIMITED',accountRetryAfterSeconds:47}}};
 assert.deepEqual(agentCandidates(context,plan,nextResults),[]);
 const observation=agentEvidence(context,plan,nextResults).observations.find(item=>item.id==='source-accounts');
 assert.equal(observation.accounts.accountStop,'RATE_LIMITED'); assert.equal(observation.accounts.accountRetryAfterSeconds,47);
 assert.match(recommendedAction(plan,nextResults).action,/at least 47 seconds/);
});

test('iteratively chooses evidence-bound checks and reaches one cited recommendation', async()=>{
 const {plan,results,client,calls}=await initial(); const before=calls.length; let rounds=0; const updates=[];
 const model=async (_instruction,payload,diagnostic)=>{
  assert.equal(typeof diagnostic,'function');
  const serialized=JSON.stringify(payload);
  assert.doesNotMatch(serialized,/private-log|private-app|192\.0\.2|auth0\|fixture/);
  rounds++;
  if (rounds<=2) return JSON.stringify({decision:'check',candidate:`event-${rounds+4}`});
  return JSON.stringify({decision:'conclude',action:'Do not reset credentials without evidence that they are stale.',reason:'Two selected events were checked.',uncertainty:'A cause is not established.',references:['followup-1','followup-2']});
 };
 const outcome=await runInvestigationAgent({context,plan,results,model,update:(_p,_r,msg)=>updates.push(msg),perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded'); assert.equal(outcome.requests,3); assert.deepEqual(outcome.recommendation.references,['followup-1','followup-2']);
 assert.equal(calls.length-before,2); assert.deepEqual(calls.slice(before).map(call=>call.input.log_id),['private-log-4','private-log-5']);
 assert.equal(outcome.plan.length,10); assert.ok(updates.some(message=>message.includes('follow-up 2')));
});
test('the agent receives per-account failure categories without account identifiers', async()=>{
 const {plan,results}=await initial();
 const source=results['source-accounts'].accountEvidence;
 assert.equal(source.accounts.filter(account=>account.directFailureTypes.unknownUser===1).length,1);
 assert.equal(source.accounts.filter(account=>account.directFailureTypes.wrongPassword===1).length,3);
 const observation=agentEvidence(context,plan,results).observations.find(item=>item.id==='source-accounts');
 assert.equal(observation.accounts.items.filter(account=>account.directFailureTypes.unknownUser===1).length,1);
 assert.equal(observation.accounts.items.filter(account=>account.directFailureTypes.wrongPassword===1).length,3);
 assert.doesNotMatch(JSON.stringify(observation),/auth0\|fixture|private-log|192\.0\.2/);
});
test('reports read:clients when an application configuration check lacks scope',async()=>{
 const {plan,results}=await initial();
 results['source-accounts'].accountEvidence.applicationConfigs=[{id:'private-client',status:'unavailable',error:'MISSING_SCOPE'}];
 assert.match(recommendedAction(plan,results).action,/read:clients/);
 assert.doesNotMatch(JSON.stringify(agentEvidence(context,plan,results)),/private-client/);
});
test('the agent sees fingerprint aggregates but never fingerprint values', async()=>{
 const plan=fullInvestigationPlan(context), fixture=fixtureTools(context), fingerprint='d'.repeat(32),ja4='t13d1516h2_8daaf6152771_b186095e22b6';
 const client={async tool(options){if(options.tool==='get_application_config')return {success:true,client_id:options.input.client_id,app_type:'spa',token_endpoint_auth_method:'none',authorization_code_enabled:true,password_enabled:false,refresh_token_enabled:true,client_credentials_enabled:false};const result=await fixture.tool(options);return options.tool==='get_log_event' && options.input.include_fingerprint && result.success ? {...result,ja3:fingerprint,ja4,client_name:'private-client-name',client_id:'private-client-id'} : result;}};
 const results=await execute(plan,context,client,'fixture',()=>{});
 results['source-accounts'].accountEvidence.accounts[0].successAfterSelected='verified';
 results['source-accounts'].accountEvidence.accounts[0].successAfterSelectedSameSource=true;
 results['source-accounts'].accountEvidence.accounts[0].successAfterSelectedSameApplication=true;
 const observation=agentEvidence(context,plan,results).observations.find(item=>item.id==='source-accounts');
 assert.equal(observation.accounts.ja3Reported,4);assert.equal(observation.accounts.ja3Groups,1);assert.equal(observation.accounts.ja3LargestGroup,4);
 assert.equal(observation.accounts.ja4FieldReturned,4);assert.equal(observation.accounts.ja4Reported,4);assert.equal(observation.accounts.ja4Groups,1);assert.equal(observation.accounts.ja4LargestGroup,4);
 assert.equal(observation.accounts.items[0].successAfterSelected,'verified');
 assert.equal(observation.accounts.items[0].successAfterSelectedSameSource,true);
 assert.equal(observation.accounts.items[0].successAfterSelectedSameApplication,true);
 assert.equal(observation.accounts.applicationNameGroups,1);assert.equal(observation.accounts.largestApplicationNameGroup,4);assert.equal(observation.accounts.missingApplication,0);
 assert.equal(observation.accounts.applicationIdGroups,1);assert.equal(observation.accounts.largestApplicationIdGroup,4);assert.equal(observation.accounts.missingApplicationId,0);
 assert.equal(observation.accounts.applicationConfigs[0].status,'verified');assert.equal(observation.accounts.applicationConfigs[0].appType,'spa');assert.deepEqual(observation.accounts.items[0].applicationRefs,['source-accounts-C1']);
 assert.doesNotMatch(JSON.stringify(observation),new RegExp(fingerprint+'|'+ja4+'|private-client-name|private-client-id'));
});

test('a generic review instruction triggers another check rather than ending the investigation',async()=>{
 const {plan,results,client,calls}=await initial(); const before=calls.length; let round=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(instructions,payload)=>{
  assert.match(instructions,/references must be an array of one to four distinct IDs/);
  round++;
  if(round===1) return JSON.stringify({decision:'conclude',action:'Review the checked pattern.',reason:'A source was found.',uncertainty:'Cause unknown.',references:['source-accounts']});
  if(round===2) {assert.match(payload.feedback,/too generic/);return JSON.stringify({decision:'check',candidate:'event-5'});}
  return JSON.stringify({decision:'conclude',action:'Do not reset credentials without evidence that they are stale.',reason:'An additional event was checked.',uncertainty:'The cause remains unknown.',references:['followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded'); assert.equal(outcome.requests,3); assert.equal(calls.length-before,1);
 assert.equal(calls.at(-1).input.log_id,'private-log-4');
});

test('runs an available check after repeated generic model recommendations',async()=>{
 const {plan,results,client}=await initial();let calls=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls<=3)return JSON.stringify({decision:'conclude',action:'Review the checked pattern.',reason:'A source was found.',uncertainty:'Cause unknown.',references:['source-accounts']});
  assert.match(payload.feedback,/application ran another available read-only check/);
  assert.ok(payload.evidence.observations.some(item=>item.id==='followup-1'));
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'A further source was checked.',uncertainty:'The cause is unknown.',references:['followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded');assert.equal(calls,4);assert.equal(outcome.plan.at(-1).tool,'investigate_source_group');
});
test('does not send the user back to manually review a source the app has inspected',async()=>{
 const {plan,results,client,calls}=await initial(); const before=calls.length; let round=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  round++;
  if(round===1) return JSON.stringify({decision:'conclude',action:'Review the specific IP addresses or ASN associated with the largest source group to determine if they correlate with known corporate infrastructure.',reason:'Failures share a source.',uncertainty:'Ownership is unknown.',references:['source-analysis']});
  if(round===2) {assert.match(payload.feedback,/repeated a source inspection/);return JSON.stringify({decision:'check',candidate:'source-2'});}
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix or establish corporate ownership.',reason:'Both source groups were checked.',uncertainty:'An external ownership inventory is unavailable.',references:['source-analysis','followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded');
 assert.equal(outcome.requests,3);
 assert.ok(calls.length>before);
 assert.equal(outcome.results['followup-1'].accountEvidence.matched,4);
 assert.match(outcome.recommendation.action,/cannot determine a fix/);
});

test('does not ask the user to repeat the account correlation already performed',async()=>{
 const {plan,results,client}=await initial();
 for (const action of ['Cross-reference the 8 failures in the largest source group with specific account identifiers to check for pattern repetition.', 'Investigate the repeated account attempts.', 'Investigate the repeated account attempts and update credentials only if they are confirmed stale.', 'Review logs for anomalous patterns and confirm if account blocks are still required.', 'Review access logs for potential account takeover if suspicious activity occurs.']) {
  let round=0;
  const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
   round++;
   if(round===1) return JSON.stringify({decision:'conclude',action,reason:'Some attempts repeat.',uncertainty:'Cause unknown.',references:['source-accounts']});
   if(round===2) {assert.match(payload.feedback,/account correlation/); return JSON.stringify({decision:'check',candidate:'event-5'});}
   return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The account and event checks did not establish a cause.',uncertainty:'The cause remains unknown.',references:['source-accounts','followup-1']});
  },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
  assert.equal(outcome.status,'concluded'); assert.equal(outcome.requests,3);
  assert.match(outcome.recommendation.action,/cannot determine a fix/);
 }
});

test('corrects a repeated manual review toward a verified primary account block',async()=>{
 const {plan,results}=await initial(),source=results['source-accounts'].accountEvidence;
 const blocked={...results,'source-accounts':{...results['source-accounts'],accountEvidence:{...source,accounts:source.accounts.map((account,index)=>index===0?{...account,profile:'verified',blocked:true}:account)}}};
 let calls=0;
 const outcome=await runInvestigationAgent({context,plan,results:blocked,model:async(instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'conclude',action:'Review the allowlist settings for brute-force protection.',reason:'The source was checked.',uncertainty:'The cause is unknown.',references:['source-analysis']});
  assert.match(instructions,/Correction from the application validator:.*verified account block is recorded in source-accounts/);
  if(calls===2){assert.match(payload.feedback,/repeated a source inspection/);return JSON.stringify({decision:'conclude',action:'Clear the block only after confirming it is no longer needed.',reason:'A verified account is blocked.',uncertainty:'The block may not explain every failure.',references:[]});}
  assert.match(payload.feedback,/one to four check IDs/);
  return JSON.stringify({decision:'conclude',action:'After confirming the block is no longer needed, clear the administrative account block.',reason:'A verified account is blocked.',uncertainty:'The block may not explain every failure.',references:['source-accounts']});
 },update:()=>{},perform:async()=>{throw Error('No follow-up expected');}});
 assert.equal(outcome.status,'concluded');assert.equal(calls,3);
});
test('does not ask the user to recheck an inspected application configuration',async()=>{
 const {plan,results}=await initial();let calls=0;
 results['source-accounts'].accountEvidence.applicationConfigs=[{id:'private-client',status:'verified',appType:'spa',authMethod:'none',authorizationCode:true,password:false,refreshToken:true,clientCredentials:false}];
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'conclude',action:"Review the application's authentication configuration for the account if repeated issues occur.",reason:'An application was checked.',uncertainty:'The cause is unknown.',references:['source-accounts']});
  assert.match(payload.feedback,/application settings were already checked/);assert.doesNotMatch(JSON.stringify(payload),/private-client/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The application settings were checked.',uncertainty:'The cause is unknown.',references:['source-accounts']});
 },update:()=>{},perform:async()=>{throw Error('No follow-up expected');}});
 assert.equal(outcome.status,'concluded');assert.equal(calls,2);
});
test('requires claims of absent failures to be scoped to checked evidence',async()=>{
 const {plan,results}=await initial();let calls=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'No further failures or suspicious activity were found for this account.',uncertainty:'The cause is unknown.',references:['source-accounts']});
  assert.match(payload.feedback,/unbounded absence claim/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'No further failures were observed in the returned pages.',uncertainty:'The cause and complete history are unknown.',references:['source-accounts']});
 },update:()=>{},perform:async()=>{throw Error('No follow-up expected');}});
 assert.equal(outcome.status,'concluded');assert.equal(calls,2);
 assert.match(outcome.recommendation.reason,/returned pages/);
});
test('does not present an isolated failure as ongoing credential testing',async()=>{
 const {plan,results}=await initial();let calls=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'conclude',action:'Monitor for continued credential testing on this account.',reason:'A wrong-password event was checked.',uncertainty:'The cause is unknown.',references:['source-accounts']});
  assert.match(payload.feedback,/do not by themselves establish ongoing credential testing/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'A failure was checked.',uncertainty:'The cause is unknown.',references:['source-accounts']});
 },update:()=>{},perform:async()=>{throw Error('No follow-up expected');}});
 assert.equal(outcome.status,'concluded');assert.equal(calls,2);
});
test('requires a cited verified block before recommending its removal',async()=>{
 const {plan,results}=await initial();
 const recommendation={decision:'conclude',action:'After confirming identity, clear the administrative account block.',reason:'A block was found.',uncertainty:'The cause is otherwise unknown.',references:['source-accounts']};
 let calls=0;
 const denied=await runInvestigationAgent({context,plan,results,model:async()=>{calls++;return JSON.stringify(recommendation);},update:()=>{},perform:async()=>{throw Error('No check should run');}});
 assert.equal(denied.status,'unavailable');assert.equal(calls,3);
 assert.match(denied.message,/without matching verified evidence/);
 const source=results['source-accounts'].accountEvidence;
 const accounts=source.accounts.map((account,index)=>index===0?{...account,profile:'verified',blocked:true}:account);
 const blocked={...results,'source-accounts':{...results['source-accounts'],accountEvidence:{...source,accounts}}};
 const accepted=await runInvestigationAgent({context,plan,results:blocked,model:async()=>JSON.stringify(recommendation),update:()=>{},perform:async()=>{throw Error('No check should run');}});
 assert.equal(accepted.status,'concluded');assert.equal(accepted.requests,1);
 const wrongType={...recommendation,action:'After confirming identity, clear the brute-force account block.'};
 const rejected=await runInvestigationAgent({context,plan,results:blocked,model:async()=>JSON.stringify(wrongType),update:()=>{},perform:async()=>{throw Error('No check should run');}});
 assert.equal(rejected.status,'unavailable');
});
test('does not recommend a password reset solely from a failed login',async()=>{
 const {plan,results}=await initial();let calls=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'conclude',action:'Advise the user to reset credentials for account A1 and review MFA settings.',reason:'A failed login occurred.',uncertainty:'The cause is unknown.',references:['source-accounts']});
  assert.match(payload.feedback,/does not establish that credentials are stale/);
  return JSON.stringify({decision:'conclude',action:'Update credentials only if they are confirmed stale.',reason:'The available events do not establish a cause.',uncertainty:'The source of the attempts is unknown.',references:['source-accounts']});
 },update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(outcome.status,'concluded');assert.equal(calls,2);assert.match(outcome.recommendation.action,/only if/);
});
test('rejects unsupported password-reset and MFA changes in either wording',async()=>{
 const {plan,results}=await initial();
 for (const action of ['Initiate a password reset for the account.','Implement multi-factor authentication.']) {
  let calls=0;
  const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
   calls++;
   if(calls===1)return JSON.stringify({decision:'conclude',action,reason:'A failure occurred.',uncertainty:'The cause is unknown.',references:['source-accounts']});
   assert.match(payload.feedback,action.includes('password') ? /does not establish that credentials/ : /do not establish the account MFA/);
   return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The observed failure does not establish a cause.',uncertainty:'The source of the attempt is unknown.',references:['source-accounts']});
  },update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
  assert.equal(outcome.status,'concluded');assert.equal(calls,2);
 }
});
test('does not propose a protection change solely from repeated failures',async()=>{
 const {plan,results}=await initial();let calls=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'conclude',action:'Implement rate limiting or CAPTCHA for the identified source groups.',reason:'Some failures share a source.',uncertainty:'The origin is unknown.',references:['source-analysis']});
  assert.match(payload.feedback,/does not by itself justify changing protection settings/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'Shared sources do not establish abuse.',uncertainty:'The origin is unknown.',references:['source-analysis']});
 },update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(outcome.status,'concluded');assert.equal(calls,2);
});
test('does not send the user back to manually review an inspected allowlist',async()=>{
 const {plan,results}=await initial();
 for (const action of ['Review the necessity of the current brute-force allowlist configuration.',"Review the 'bruteForceAllowlisted' configuration for identified source groups.",'Review and potentially tighten security policies for the application.']) {
  let calls=0;
  const outcome=await runInvestigationAgent({context,plan,results,model:async(instructions,payload)=>{
   calls++;
   if(calls===1)return JSON.stringify({decision:'conclude',action,reason:'The source was compared.',uncertainty:'Business justification is unknown.',references:['source-analysis']});
   assert.match(payload.feedback,/repeated a source inspection/);assert.match(instructions,/Do not ask for another allowlist/);
   return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The allowlist was inspected but its business purpose is unknown.',uncertainty:'The intended access policy is unavailable.',references:['source-analysis']});
  },update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
  assert.equal(outcome.status,'concluded');assert.equal(calls,2);
 }
});
test('does not accept an empty action or deny uncertainty with incomplete checks',async()=>{
 const {plan,results}=await initial();
 for (const [action,uncertainty] of [['None; no compromise identified.','The cause is unknown.'],['Monitor the account for further failures.','None; no evidence of compromise.']]) {
  let calls=0;
  const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
   calls++;
   if(calls===1)return JSON.stringify({decision:'conclude',action,reason:'One selected event was checked.',uncertainty,references:['source-accounts']});
   assert.match(payload.feedback,/specific action.*cannot determine a fix/);
   return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The checked evidence is incomplete.',uncertainty:'The cause remains unknown.',references:['source-accounts']});
  },update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
  assert.equal(outcome.status,'concluded');assert.equal(calls,2);
 }
});

test('can investigate a second source group and follow its linked accounts', async()=>{
 const {plan,results,client,calls}=await initial(); let round=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  round++;
  if (round===1) { assert.ok(payload.candidates.some(item=>item.id==='source-2')); return JSON.stringify({decision:'check',candidate:'source-2'}); }
  assert.doesNotMatch(JSON.stringify(payload),/192\.0\.2|private-log|auth0\|fixture/);
  return JSON.stringify({decision:'conclude',action:'Do not change protection settings based only on this source group.',reason:'The source group and account checks completed.',uncertainty:'Intent remains unknown.',references:['followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded'); assert.equal(outcome.plan.at(-1).sourceRank,2);
 assert.equal(outcome.results['followup-1'].accountEvidence.matched,4);
 assert.equal(outcome.results['followup-1'].facts.sourceIp,'192.0.2.11');
 assert.ok(calls.some(call=>call.input.log_id==='private-log-4' && call.input.include_identity_hint));
});
test('compares directly linked verified accounts across source groups without exposing IDs',async()=>{
 const grouped={...context,events:Array.from({length:12},(_,i)=>({...events[0],id:`overlap-${i}`,time:now-(i+1)*1000,source:i<8?1:2,account:i<8?Math.floor(i/2)+1:i<10?1:5}))};
 const plan=fullInvestigationPlan(grouped),client=fixtureTools(grouped),results=await execute(plan,grouped,client,'fixture',()=>{});
 const outcome=await runInvestigationAgent({context:grouped,plan,results,model:async(_instructions,payload)=>{
  assert.deepEqual(payload.evidence.crossSourceAccounts,[{primaryCheck:'source-accounts',sourceCheck:'followup-1',sourceRank:2,sharedVerifiedAccounts:1}]);
  assert.doesNotMatch(JSON.stringify(payload),/auth0\|fixture|overlap-\d|192\.0\.2/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'One account was directly linked across sources.',uncertainty:'Who submitted the attempts is unknown.',references:['source-accounts','followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded');
 const secondary=outcome.results['followup-1'].accountEvidence;
 secondary.accounts.find(account=>account.userId==='auth0|fixture-1').profile='failed';
 assert.equal(agentEvidence(grouped,outcome.plan,outcome.results).crossSourceAccounts[0].sharedVerifiedAccounts,0);
});
test('checks other source groups when repeated submitted identifiers have no verified account',async()=>{
 const {plan,results,client}=await initial(),source=results['source-accounts'].accountEvidence;
 const unresolved={...results,'source-accounts':{...results['source-accounts'],accountEvidence:{...source,missingIdentity:2,unresolvedIdentifiers:[{identifier:'private-identifier',count:2,reason:'No matching account.'}]}}};
 const outcome=await runInvestigationAgent({context,plan,results:unresolved,model:async(_instructions,payload)=>{
  assert.ok(payload.evidence.observations.some(item=>item.tool==='investigate_source_group'));
  assert.doesNotMatch(JSON.stringify(payload),/private-identifier/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The repeated identifiers and other source were checked.',uncertainty:'The account association is unknown.',references:['source-accounts']});
 },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded');assert.equal(outcome.requests,1);
 assert.equal(outcome.plan.filter(step=>step.tool==='investigate_source_group').length,1);
});
test('checks source groups and remaining candidates before the first model request',async()=>{
 const grouped={...context,events:Array.from({length:14},(_,i)=>({...events[0],id:`grouped-${i}`,time:now-(i+1)*1000,source:i<8?1:i<12?2:3,account:Math.floor(i/2)+1}))};
 const plan=fullInvestigationPlan(grouped),client=fixtureTools(grouped),results=await execute(plan,grouped,client,'fixture',()=>{});
 let calls=0;const outcome=await runInvestigationAgent({context:grouped,plan,results,maxRequests:3,model:async(_instructions,payload)=>{
  calls++;
  assert.ok(payload.evidence.observations.some(item=>item.id==='followup-1' && item.tool==='investigate_source_group'));
  assert.ok(payload.evidence.observations.some(item=>item.id==='followup-2' && item.tool==='investigate_source_group'));
  assert.ok(payload.evidence.observations.some(item=>item.tool==='search_authentication_history' && item.period==='previous_24h'));
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'Repeated failures were checked.',uncertainty:'The cause is unknown.',references:['source-accounts']});
 },update:()=>{},perform:(next,prior)=>execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded');assert.equal(outcome.requests,1);
 assert.deepEqual(outcome.plan.filter(step=>step.tool==='investigate_source_group').map(step=>step.sourceRank),[2,3]);
 assert.equal(outcome.results['followup-1'].accountEvidence.matched,4);
 assert.equal(outcome.results['followup-2'].accountEvidence.matched,2);
});
test('exhausts remaining checks when a model-selected source reveals repetition',async()=>{
 const grouped={...context,events:events.map((event,index)=>({...event,account:index<4?index+1:5}))};
 const plan=fullInvestigationPlan(grouped),client=fixtureTools(grouped),results=await execute(plan,grouped,client,'fixture',()=>{});let calls=0;
 const outcome=await runInvestigationAgent({context:grouped,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'check',candidate:'source-2'});
  assert.ok(payload.evidence.observations.some(item=>item.tool==='search_authentication_history' && item.period==='previous_24h'));
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The repeated attempts were checked.',uncertainty:'The cause is unknown.',references:['followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded');assert.equal(calls,2);
});
test('shares follow-up capacity between source groups and shallow account histories',async()=>{
 const grouped={...context,events:Array.from({length:10},(_,i)=>({...events[0],id:`breadth-${i}`,time:now-(i+1)*1000,source:i<8?1:2,account:i<4?1:i<8?2:3}))};
 const plan=fullInvestigationPlan(grouped),client=fixtureTools(grouped),results=await execute(plan,grouped,client,'fixture',()=>{});
 const evidence=results['source-accounts'].accountEvidence;
 evidence.accounts=evidence.accounts.map(account=>({...account,logsPageFull:true}));
 const outcome=await runInvestigationAgent({context:grouped,plan,results,model:async()=>JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The source and histories were checked.',uncertainty:'The cause is unknown.',references:['source-accounts']}),update:()=>{},perform:async(next,prior)=>{
  const step=next.at(-1);
  if(step.tool!=='investigate_account_history')return execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior);
  return {...prior,[step.id]:{state:'success',facts:{},historyEvidence:{page:step.historyPage,returned:20,failures:0,verified:0,matchingSource:0,duplicates:0,unavailable:0,unchecked:0,pageFull:step.historyPage===1,verifiedEventIds:[],rateRetries:0}}};
 }});
 assert.equal(outcome.status,'concluded');
 const followups=outcome.plan.filter(step=>/^followup-\d+$/.test(step.id));
 assert.deepEqual(followups.slice(0,3).map(step=>step.tool),['investigate_account_history','investigate_source_group','investigate_account_history']);
 assert.deepEqual(followups.filter(step=>step.tool==='investigate_account_history').map(step=>step.historyPage),[1,1,2,2]);
});
test('a primary account block does not stop comparisons of other repeated source groups',async()=>{
 const grouped={...context,events:Array.from({length:14},(_,i)=>({...events[0],id:`primary-${i}`,time:now-(i+1)*1000,source:i<8?1:i<12?2:3,account:Math.floor(i/2)+1}))};
 const fixture=fixtureTools(grouped);
 const client={async tool(input){const result=await fixture.tool(input);return input.tool==='get_user' && input.input.user_id==='auth0|fixture-1' ? {...result,blocked:true} : result;}};
 const plan=fullInvestigationPlan(grouped),results=await execute(plan,grouped,client,'fixture',()=>{});
 const outcome=await runInvestigationAgent({context:grouped,plan,results,model:async(_instructions,payload)=>{
  assert.ok(payload.evidence.observations.some(item=>item.id==='followup-2'));
  return JSON.stringify({decision:'conclude',action:'After confirming the block is no longer needed, clear the administrative account block.',reason:'A verified account is blocked.',uncertainty:'The block may not explain every failure.',references:['source-accounts']});
 },update:()=>{},perform:(next,prior)=>execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded'); assert.equal(outcome.requests,1);
 assert.deepEqual(outcome.plan.filter(step=>step.tool==='investigate_source_group').map(step=>step.sourceRank),[2,3]);
 assert.equal(recommendedAction(outcome.plan,outcome.results).kind,'verified-block');
});
test('a secondary group block neither stops exploration nor supports the primary fix',async()=>{
 const grouped={...context,events:Array.from({length:14},(_,i)=>({...events[0],id:`secondary-${i}`,time:now-(i+1)*1000,source:i<8?1:i<12?2:3,account:Math.floor(i/2)+1}))};
 const fixture=fixtureTools(grouped);
 const client={async tool(input){const result=await fixture.tool(input);return input.tool==='get_user' && input.input.user_id==='auth0|fixture-5' ? {...result,blocked:true} : result;}};
 const plan=fullInvestigationPlan(grouped),results=await execute(plan,grouped,client,'fixture',()=>{}); let requests=0;
 const outcome=await runInvestigationAgent({context:grouped,plan,results,model:async(_instructions,payload)=>{
  requests++; assert.doesNotMatch(JSON.stringify(payload),/auth0\|fixture|192\.0\.2|secondary-\d/);
  assert.ok(payload.evidence.observations.some(item=>item.id==='followup-2'));
  if(requests===1)return JSON.stringify({decision:'conclude',action:'Clear the administrative account block.',reason:'A block was found.',uncertainty:'Cause unknown.',references:['followup-1']});
  assert.match(payload.feedback,/not supported by a cited verified account block/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'Repeated failures were checked.',uncertainty:'The cause is unknown.',references:['source-accounts']});
 },update:()=>{},perform:(next,prior)=>execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded'); assert.equal(requests,2);
 assert.ok(outcome.results['followup-1'].accountEvidence.accounts.some(account=>account.blocked));
 assert.equal(outcome.results['followup-2'].accountEvidence.matched,2);
 assert.notEqual(recommendedAction(outcome.plan,outcome.results).kind,'verified-block');
});
test('covers four full account histories and ten other groups in an eight-of-18 case',async()=>{
 const grouped={...context,events:Array.from({length:18},(_,i)=>({...events[0],id:`eight-${i}`,time:now-(i+1)*1000,source:i<8?1:i-6,account:i<8?Math.floor(i/2)+1:i+10}))};
 const plan=fullInvestigationPlan(grouped),client=fixtureTools(grouped),results=await execute(plan,grouped,client,'fixture',()=>{});
 results['source-accounts'].accountEvidence.accounts=results['source-accounts'].accountEvidence.accounts.map(account=>({...account,logsPageFull:true}));
 const outcome=await runInvestigationAgent({context:grouped,plan,results,model:async(_instructions,payload)=>{
  assert.equal(payload.evidence.followupLimitReached,false);
  assert.equal(payload.evidence.observations.filter(item=>item.tool==='investigate_account_history').length,16);
  assert.equal(payload.evidence.observations.filter(item=>item.tool==='investigate_source_group').length,10);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The returned history and sources were checked.',uncertainty:'The cause is unknown.',references:['source-accounts']});
 },update:()=>{},perform:async(next,prior)=>{const step=next.at(-1);if(step.tool!=='investigate_account_history')return execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior);return {...prior,[step.id]:{state:'success',facts:{},historyEvidence:{page:step.historyPage,returned:20,failures:0,verified:0,matchingSource:0,duplicates:0,unavailable:0,unchecked:0,pageFull:true,verifiedEventIds:[],rateRetries:0}}};}});
 assert.equal(outcome.status,'concluded');assert.equal(outcome.requests,1);
});
test('reports when the bounded follow-up graph leaves eligible checks unrun',async()=>{
 const grouped={...context,events:Array.from({length:37},(_,i)=>({...events[0],id:`limit-${i}`,time:now-(i+1)*1000,source:i<16?1:i-14,account:i<16?Math.floor(i/2)+1:i+10}))};
 const plan=fullInvestigationPlan(grouped),client=fixtureTools(grouped),results=await execute(plan,grouped,client,'fixture',()=>{});
 results['source-accounts'].accountEvidence.accounts=results['source-accounts'].accountEvidence.accounts.map(account=>({...account,logsPageFull:true}));
 const outcome=await runInvestigationAgent({context:grouped,plan,results,maxRequests:2,model:async(_instructions,payload)=>{
  assert.equal(payload.evidence.followupLimitReached,true);assert.deepEqual(payload.candidates,[]);
  assert.equal(payload.evidence.sourceGroupsBeyondLimit,2);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'Repeated failures were checked.',uncertainty:'Some eligible checks remain unrun.',references:['source-accounts']});
 },update:()=>{},perform:async(next,prior)=>{const step=next.at(-1);if(step.tool!=='investigate_account_history')return execute(next,grouped,client,'fixture',()=>{},()=>true,30000,undefined,prior);return {...prior,[step.id]:{state:'success',facts:{},historyEvidence:{page:step.historyPage,returned:20,failures:0,verified:0,matchingSource:0,duplicates:0,unavailable:0,unchecked:0,pageFull:true,verifiedEventIds:[],rateRetries:0}}};}});
 assert.equal(outcome.status,'concluded');assert.equal(outcome.requests,1);
 assert.equal(outcome.plan.filter(step=>step.tool==='investigate_source_group').length,19);
 assert.equal(outcome.plan.filter(step=>/^followup-\d+$/.test(step.id)).length,39);
 assert.match(outcome.message,/39-check follow-up limit.*remain/);
 assert.match(outcome.message,/2 source group\(s\) exceed/);
 const unavailable=await runInvestigationAgent({context:grouped,plan:outcome.plan,results:outcome.results,maxRequests:1,model:async()=>{throw Error('Provider unavailable');},update:()=>{},perform:async()=>{throw Error('No follow-up expected');}});
 assert.equal(unavailable.status,'unavailable');assert.match(unavailable.message,/39-check follow-up limit.*remain/);assert.match(unavailable.message,/2 source group\(s\) exceed/);
});

test('checks a full account-log page before the first model request', async()=>{
 const olderContext={...context,events:Array.from({length:20},(_,i)=>({...events[0],id:`selected-${i}`,time:now-(i+1)*1000,account:1,source:1}))};
 const fixture=fixtureTools(olderContext),calls=[];
 const oldRows=[{log_id:'selected-0',date:new Date(olderContext.events[0].time).toISOString(),type:'fp',description:'Wrong password'},
  ...[0,1].map(i=>({log_id:`older-${i}`,date:new Date(now-86400000-i*1000).toISOString(),type:'fp',description:'Wrong password'}))];
 const client={async tool(input){
  calls.push(input);
  if(input.tool==='get_user_logs' && input.input.page===1) return {success:true,events:oldRows,count:oldRows.length};
  if(input.tool==='get_log_event' && String(input.input.log_id).startsWith('older-')) {const row=oldRows.find(item=>item.log_id===input.input.log_id);return {success:true,...row,user_id:'auth0|fixture-1',source_ip:'192.0.2.10'};}
  return fixture.tool(input);
 }};
 const plan=fullInvestigationPlan(olderContext),results=await execute(plan,olderContext,client,'fixture',()=>{});
 assert.equal(results['source-accounts'].state,'partial'); assert.equal(results['source-accounts'].accountEvidence.accounts[0].logsPageFull,true);
 const previousDetailCalls=calls.filter(call=>call.tool==='get_log_event' && call.input.log_id==='selected-0').length;
 let round=0;
 const outcome=await runInvestigationAgent({context:olderContext,plan,results,model:async(_instructions,payload)=>{
  assert.doesNotMatch(JSON.stringify(payload),/auth0\|fixture|selected-|192\.0\.2/);
  round++;
  assert.ok(payload.evidence.observations.some(item=>item.id==='followup-1' && item.facts.matchingSource===2));
  return JSON.stringify({decision:'conclude',action:'Update credentials only if they are confirmed stale.',reason:'Older same-source failures were verified.',uncertainty:'The cause remains unknown.',references:['followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,olderContext,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded');
 assert.equal(outcome.requests,1);
 assert.equal(outcome.results['followup-1'].historyEvidence.matchingSource,2);
 assert.equal(outcome.results['followup-1'].historyEvidence.duplicates,1);
 assert.equal(calls.filter(call=>call.tool==='get_user_logs' && call.input.page===1).length,1);
 assert.equal(calls.filter(call=>call.tool==='get_log_event' && call.input.log_id==='selected-0').length,previousDetailCalls);
});

test('can continue through four full-page follow-ups and stops when the last page is short', async()=>{
 const current={...context,events:Array.from({length:20},(_,i)=>({...events[0],id:`selected-${i}`,time:now-(i+1)*1000,account:1,source:1}))};
 const fixture=fixtureTools(current), pages=[];
 const client={async tool(input){
  if(input.tool==='get_user_logs' && input.input.page) {
   const page=input.input.page; pages.push(page);
   const count=page===4?1:20;
   const rows=Array.from({length:count},(_,i)=>({log_id:`p${page}-${i}`,date:new Date(now-page*86400000-i*1000).toISOString(),type:i===0?'fp':'s',description:'Fictional event'}));
   return {success:true,events:rows,count:rows.length};
  }
  if(input.tool==='get_log_event' && /^p\d+-/.test(String(input.input.log_id))) {
   const [page,index]=String(input.input.log_id).slice(1).split('-').map(Number);
   return {success:true,log_id:input.input.log_id,date:new Date(now-page*86400000-index*1000).toISOString(),type:'fp',user_id:'auth0|fixture-1',source_ip:'192.0.2.10'};
  }
  return fixture.tool(input);
 }};
 const plan=fullInvestigationPlan(current),results=await execute(plan,current,client,'fixture',()=>{});
 const outcome=await runInvestigationAgent({context:current,plan,results,model:async(_i,payload)=>{
  const candidate=payload.candidates.find(item=>item.id.startsWith('history-'));
  return candidate?JSON.stringify({decision:'check',candidate:candidate.id}):JSON.stringify({decision:'conclude',action:'Update credentials only if they are confirmed stale.',reason:'Older source failures were checked.',uncertainty:'The cause is unknown.',references:['followup-4']});
 },update:()=>{},perform:(next,prior)=>execute(next,current,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded'); assert.deepEqual(pages,[1,2,3,4]);
 assert.equal(outcome.results['followup-4'].historyEvidence.pageFull,false);
});

test('rejects invented, repeated or unsafe checks and ungrounded conclusions',async()=>{
 const {plan,results}=await initial(); let executions=0;
 for (const decision of [
  {decision:'check',candidate:'delete-user'},
  {decision:'check',candidate:'event-1'},
  {decision:'check',candidate:'event-2'},
  {decision:'check',candidate:'event-5',input:{user_id:'private'}},
  {decision:'conclude',action:'Change a setting',reason:'Because',uncertainty:'Unknown',references:['missing']},
 ]) {
  const outcome=await runInvestigationAgent({context,plan,results,model:async()=>JSON.stringify(decision),update:()=>{},perform:async()=>{executions++;return results;}});
  assert.equal(outcome.status,'unavailable');
 }
 assert.equal(executions,0);
});

test('automatically corrects a malformed decision without executing or echoing it',async()=>{
 const {plan,results,client,calls}=await initial(); const before=calls.length; let round=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  round++;
  if(round===1) return JSON.stringify({decision:'check',candidate:'private-invented-operation'});
  if(round===2) {assert.match(payload.feedback,/unavailable/);assert.doesNotMatch(JSON.stringify(payload),/private-invented-operation/);return JSON.stringify({decision:'check',candidate:'event-5'});}
  return JSON.stringify({decision:'conclude',action:'Do not change settings based on this event alone.',reason:'An additional event was verified.',uncertainty:'The cause is unknown.',references:['followup-1']});
 },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'concluded'); assert.equal(outcome.requests,3); assert.equal(calls.length-before,1);
});

test('stops at the request budget and preserves completed evidence',async()=>{
 const budgetContext={...context,events:Array.from({length:20},(_,i)=>({...events[0],id:`budget-${i}`,account:i+1,source:i+1}))};
 const plan=fullInvestigationPlan(budgetContext), calls=[], fixture=fixtureTools(budgetContext);
 const client={async tool(input){calls.push(input);return fixture.tool(input);}};
 const results=await execute(plan,budgetContext,client,'fixture',()=>{}); const before=calls.length;
 const outcome=await runInvestigationAgent({context:budgetContext,plan,results,model:async(_i,p)=>JSON.stringify({decision:'check',candidate:p.candidates[0]?.id ?? 'none'}),update:()=>{},perform:(next,prior)=>execute(next,budgetContext,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'limit'); assert.equal(outcome.requests,MAX_AGENT_REQUESTS);
 assert.ok(calls.length-before>=MAX_AGENT_REQUESTS-1); assert.equal(outcome.plan.length,plan.length+MAX_AGENT_REQUESTS-1); assert.equal(outcome.results.event.state,'success');
});
test('a smaller request limit is communicated to the agent and enforced',async()=>{
 const {plan,results,client}=await initial();const remaining=[];
 const outcome=await runInvestigationAgent({context,plan,results,maxRequests:2,model:async(_instructions,payload)=>{
  remaining.push(payload.remainingRequests);
  return payload.remainingRequests===1
   ? JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The selected evidence was checked.',uncertainty:'The cause remains unknown.',references:['source-accounts']})
   : JSON.stringify({decision:'check',candidate:'event-5'});
 },update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.deepEqual(remaining,[2,1]);assert.equal(outcome.status,'concluded');assert.equal(outcome.requests,2);
 await assert.rejects(runInvestigationAgent({context,plan,results,maxRequests:MAX_AGENT_REQUESTS+1,model:async()=>'',update:()=>{},perform:async()=>results}),/Invalid investigation request limit/);
});
test('invalid conclusions receive precise privacy-safe correction feedback',async()=>{
 const {plan,results}=await initial();let calls=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async(_instructions,payload)=>{
  calls++;
  if(calls===1)return JSON.stringify({decision:'conclude',action:'x'.repeat(301),reason:'Unknown.',uncertainty:'Unknown.',references:['private-invalid-reference']});
  assert.match(payload.feedback,/action must be a nonempty string/);
  assert.match(payload.feedback,/references must name existing successful or partial check IDs/);
  assert.match(payload.feedback,/valid check IDs:.*source-accounts/);
  assert.doesNotMatch(payload.feedback,/private-invalid-reference/);
  return JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The available checks are inconclusive.',uncertainty:'The cause is unknown.',references:['source-accounts']});
 },update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(outcome.status,'concluded');assert.equal(calls,2);
 const failed=await runInvestigationAgent({context,plan,results,model:async()=>JSON.stringify({decision:'conclude',action:'x'.repeat(301),reason:'Unknown.',uncertainty:'Unknown.',references:['private-invalid-reference']}),update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(failed.status,'unavailable');assert.match(failed.message,/action must be a nonempty string/);assert.match(failed.message,/references must name existing/);assert.doesNotMatch(failed.message,/private-invalid-reference/);
});
test('event aliases map only to a unique successful event check',async()=>{
 const {plan,results}=await initial();
 const model=async()=>JSON.stringify({decision:'conclude',action:'The evidence cannot determine a fix.',reason:'The event was checked.',uncertainty:'The cause is unknown.',references:['E1']});
 const accepted=await runInvestigationAgent({context,plan,results,model,update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(accepted.status,'concluded');assert.deepEqual(accepted.recommendation.references,['event']);
 const failed=await runInvestigationAgent({context,plan,results:{...results,event:{state:'failed',detail:'Unavailable'}},model,update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(failed.status,'unavailable');
 const duplicate={...plan.find(step=>step.id==='event'),id:'event-copy'};
 const ambiguous=await runInvestigationAgent({context,plan:[...plan,duplicate],results:{...results,'event-copy':results.event},model,update:()=>{},perform:async()=>{throw Error('Unexpected follow-up');}});
 assert.equal(ambiguous.status,'unavailable');
});

test('does not perform another check after the context changes',async()=>{
 const {plan,results}=await initial(); let active=true,executed=false;
 const outcome=await runInvestigationAgent({context,plan,results,model:async()=>{active=false;return JSON.stringify({decision:'check',candidate:'event-5'});},active:()=>active,update:()=>{},perform:async()=>{executed=true;return results;}});
 assert.equal(outcome.status,'unavailable'); assert.equal(executed,false);
});

test('agent cannot bypass a rate limit that stopped the source investigation',async()=>{
 const {plan,results}=await initial();let rounds=0,executed=false;
 const limited={...results,'source-accounts':{...results['source-accounts'],state:'partial',accountEvidence:{...results['source-accounts'].accountEvidence,eventStopReason:'RATE_LIMITED'}}};
 const outcome=await runInvestigationAgent({context,plan,results:limited,model:async(_instructions,payload)=>{
  rounds++;assert.deepEqual(payload.candidates,[]);
  if(rounds===1) return JSON.stringify({decision:'check',candidate:'source-2'});
  assert.match(payload.feedback,/unavailable/);
  return JSON.stringify({decision:'conclude',action:'Wait for the Auth0 rate limit to clear before rerunning.',reason:'The source reads were rate limited.',uncertainty:'The cause remains unknown.',references:['source-accounts']});
 },update:()=>{},perform:async()=>{executed=true;return limited;}});
 assert.equal(outcome.status,'concluded');assert.equal(outcome.requests,2);assert.equal(executed,false);
});

test('agent receives the stated retry interval for a rate-limited check',async()=>{
 const {plan,results}=await initial();
 results.event={state:'failed',detail:'RATE_LIMITED Retry after 30 seconds.',facts:{retryAfterSeconds:30}};
 const observation=agentEvidence(context,plan,results).observations.find(item=>item.id==='event');
 assert.equal(observation.errorCode,'RATE_LIMITED');
 assert.equal(observation.facts.retryAfterSeconds,30);
});

test('preserves completed follow-ups when a later model request fails',async()=>{
 const {plan,results,client,calls}=await initial(); const before=calls.length; let round=0;
 const outcome=await runInvestigationAgent({context,plan,results,model:async()=>{if (++round===1) return JSON.stringify({decision:'check',candidate:'event-5'}); throw new Error('private provider detail');},update:()=>{},perform:(next,prior)=>execute(next,context,client,'fixture',()=>{},()=>true,30000,undefined,prior)});
 assert.equal(outcome.status,'unavailable'); assert.equal(outcome.requests,2);
 assert.equal(outcome.results['followup-1'].state,'success'); assert.equal(calls.length-before,1);
 assert.doesNotMatch(outcome.message,/private provider detail/);
});

test('agent summaries omit account identities, source IPs, submitted usernames and raw errors',async()=>{
 const {plan,results}=await initial();
 results['source-analysis'].facts.sourceIp='203.0.113.123';
 results['source-accounts'].accountEvidence.unresolvedIdentifiers=[{identifier:'secret@example.com',count:1,reason:'private text'}];
 results.event.detail='private error or raw content';
 const text=JSON.stringify(agentEvidence(context,plan,results));
 assert.doesNotMatch(text,/203\.0\.113|secret@example|private-log|private-app|private error|auth0\|fixture/);
});

test('agent sees repetition among unresolved submitted identifiers without seeing their values',async()=>{
 const {plan,results}=await initial();
 results['source-accounts'].accountEvidence.unresolvedIdentifiers=[{identifier:'private-user',count:3,reason:'unsupported username'},{identifier:'secret@example.com',count:1,reason:'no exact match'}];
 const observation=agentEvidence(context,plan,results).observations.find(item=>item.id==='source-accounts');
 assert.deepEqual(observation.accounts.unresolvedSubmittedIdentifiers,{unique:2,repeated:1,attemptCounts:[3,1]});
 assert.doesNotMatch(JSON.stringify(observation),/private-user|secret@example/);
});

test('agent distinguishes verified repeated accounts from email candidates and unverified profiles',async()=>{
 const {plan,results}=await initial();
 const source=results['source-accounts'].accountEvidence;
 source.accounts=source.accounts.map((item,index)=>({...item,selectedFailures:2,directFailures:index===1?0:2,emailHintFailures:index===1?2:0,sameSourceRecentFailures:0,profile:index===2?'mismatch':'verified'}));
 source.accounts[3].selectedFailures=1;source.accounts[3].directFailures=1;source.accounts[3].sameSourceRecentFailures=2;
 const accounts=agentEvidence(context,plan,results).observations.find(item=>item.id==='source-accounts').accounts;
 assert.deepEqual([accounts.reportedAccountIds,accounts.identified,accounts.repeated,accounts.candidateRepeated,accounts.unverifiedRepeated],[4,3,2,1,1]);
});

test('agent observations retain safe event and time-window bindings',async()=>{
 const {plan,results}=await initial();
 const observations=agentEvidence(context,plan,results).observations;
 for (const step of plan.filter(item=>item.ref)) assert.equal(observations.find(item=>item.id===step.id).eventRef,step.ref);
 for (const step of plan.filter(item=>item.period)) assert.equal(observations.find(item=>item.id===step.id).period,step.period);
});

test('agent sees trusted-list matches without receiving the source address',async()=>{
 const {plan,results}=await initial();
 const source=results['source-analysis'];
 source.facts.bruteForceAllowlisted=true;
 source.facts.throttlingAllowlisted=false;
 source.facts.allowlistError='MISSING_SCOPE';
 source.facts.aclError='MISSING_SCOPE';
 source.facts.aclCoverage='partial';
 source.facts.aclRangeMatches=1;
 source.facts.sourceIp='203.0.113.123';
 const observation=agentEvidence(context,plan,results).observations.find(item=>item.id==='source-analysis');
 assert.equal(observation.facts.bruteForceAllowlisted,true);
 assert.equal(observation.facts.throttlingAllowlisted,false);
 assert.equal(observation.allowlistError,'MISSING_SCOPE');
 assert.equal(observation.aclError,'MISSING_SCOPE');
 assert.equal(observation.aclCoverage,'partial');
 assert.equal(observation.facts.aclRangeMatches,1);
 assert.doesNotMatch(JSON.stringify(observation),/203\.0\.113/);
});

test('agent can distinguish missing permissions from incomplete account evidence without raw errors',async()=>{
 const {plan,results}=await initial();
 const accounts=results['source-accounts'].accountEvidence.accounts;
 results['source-accounts'].accountEvidence.eventErrors={MISSING_SCOPE:2};
 accounts[0].logsError='MISSING_SCOPE';
 accounts[1].blocksError='RATE_LIMITED Retry after 10 seconds.';
 accounts[2].profileError='private raw provider text';
 accounts[3].recentDetailsUnchecked=7;
 results['source-accounts'].accountEvidence.detailStopReason='RATE_LIMITED';
 results.event={state:'failed',detail:'AUTHENTICATION_FAILED'};
 const evidence=agentEvidence(context,plan,results);
 const source=evidence.observations.find(item=>item.id==='source-accounts');
 assert.deepEqual(source.accounts.requestErrors.events,{MISSING_SCOPE:2});
 assert.deepEqual(source.accounts.requestErrors.logs,{MISSING_SCOPE:1});
 assert.deepEqual(source.accounts.requestErrors.blocks,{RATE_LIMITED:1});
 assert.deepEqual(source.accounts.requestErrors.profiles,{});
 assert.equal(source.accounts.items[3].recentDetailsUnchecked,7);
 assert.equal(source.accounts.recentDetailStop,'RATE_LIMITED');
 assert.equal(evidence.observations.find(item=>item.id==='event').errorCode,'AUTHENTICATION_FAILED');
 assert.doesNotMatch(JSON.stringify(evidence),/private raw provider text|auth0\|fixture/);
});
