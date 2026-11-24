import test from 'node:test';
import assert from 'node:assert/strict';
import {accountCandidates, createInvestigation, executeInvestigation, findings, investigationRecommendation, supportedEmail, targetType, validateTarget} from '../src/investigation.ts';
import {accountCaseRecommendation, accountCaseSummary, accountTimeComparison, customerReplyDraft, identifierNextSteps, identifierProtectionAdvice, laterAccountSuccess, mfaEvidenceCaveat, matchesReportedApplication, nearReportedTime, recentAccountEvents, reportedIssue} from '../src/accountCase.ts';
import {demoClient, demoTarget, demoAnalysis} from '../src/offlineDemo.ts';
import {invokeRead, retrieveEvidence} from '../src/operations.ts';
const ok = data => ({success:true,...data});
const base = {search_users:ok({users:[{user_id:'auth0|1',email:'a@example.com',secret:'hidden'}],count:1}),get_user:ok({user_id:'auth0|1',email:'a@example.com',blocked:false,connections:[]}),get_user_logs:ok({events:[{log_id:'e1',date:null,type:'f',description:'Failure'}],count:1}),get_user_blocks:ok({has_blocks:false,block_count:0,blocks:[]})};
const step = (r,id) => r.steps.find(s=>s.id===id);
async function run(overrides={}, analyze=async e => `Review ${e[2].tool}`) { const calls=[]; const states=[]; const client={async tool(o){calls.push(o.tool); return {...base,...overrides}[o.tool];}}; const result=await executeInvestigation(createInvestigation('a@example.com'),client,'token',analyze,r=>states.push(r)); return {result,calls,states}; }
test('successful account investigation collects verified evidence and records state transitions',async()=>{const {result,calls,states}=await run(); assert.deepEqual(calls,['search_users','get_user','get_user_logs','get_user_blocks']); assert.equal(step(result,'report').state,'completed'); assert.match(result.diagnosis,/get_user_logs/); assert.equal(step(result,'search').evidence.data.users[0].secret,undefined); for(const id of ['search','profile','logs','blocks','aggregate','diagnosis','report']) assert.ok(states.some(s=>step(s,id).state==='running'));});
test('zero and multiple matches stop account checks',async()=>{for(const users of [[],[{user_id:'1',email:'a@example.com'},{user_id:'2',email:'a@example.com'}]]){const {result,calls}=await run({search_users:ok({users,count:users.length})}); assert.deepEqual(calls,['search_users']); assert.equal(step(result,'match').state,'warning'); assert.equal(step(result,'logs').state,'skipped'); assert.equal(step(result,'not-found').state,users.length?'skipped':'warning');}});
test('multiple-account candidates require exact email matches and distinct usable IDs',async()=>{
 const users=[{user_id:'auth0|1',email:'a@example.com'},{user_id:'google-oauth2|2',email:'A@EXAMPLE.COM'}];
 const {result,calls}=await run({search_users:ok({users,count:2})});
 assert.deepEqual(calls,['search_users']); assert.deepEqual(accountCandidates(result),['auth0|1','google-oauth2|2']);
 for(const invalid of [[users[0],{...users[1],email:'other@example.com'}],[users[0],{...users[1],user_id:'auth0|1'}],[users[0],{...users[1],user_id:'invalid'}],[users[0],{...users[1],user_id:' auth0|2'}]]) {
  assert.deepEqual(accountCandidates((await run({search_users:ok({users:invalid,count:2})})).result),[]);
 }
});
test('selected candidate must still match the original email before account reads',async()=>{
 for(const email of ['other@example.com',null]) {
  const calls=[]; const client={tool:async({tool})=>{calls.push(tool);return tool==='get_user'?ok({user_id:'auth0|1',email,blocked:false,connections:[]}):base[tool];}};
  const result=await executeInvestigation(createInvestigation('auth0|1','user_id'),client,'token',undefined,()=>{},{expectedEmail:'a@example.com'});
  assert.deepEqual(calls,['get_user']); assert.equal(step(result,'profile').state,'failed'); assert.equal(step(result,'logs').state,'skipped');
 }
 const calls=[]; const client={tool:async({tool})=>{calls.push(tool);return base[tool];}};
 const result=await executeInvestigation(createInvestigation('auth0|1','user_id'),client,'token',undefined,()=>{},{expectedEmail:'A@EXAMPLE.COM'});
 assert.deepEqual(calls,['get_user','get_user_logs','get_user_blocks']);
 const context={incidentTime:'',application:'',symptom:'',ticket:'',reportedEmail:'a@example.com',selectedFromMultiple:true};
 const summary=accountCaseSummary(result,context,false);
 assert.match(summary,/Reported email: a@example.com/);
 assert.match(summary,/manually selected from multiple email matches; selection is not proof of authorization/);
 assert.doesNotMatch(accountCaseSummary(result,{...context,selectedFromMultiple:false},false),/manually selected from multiple/);
});
test('no account found directs the operator to the separate identifier checks',async()=>{const {result}=await run({search_users:ok({users:[],count:0})}); const advice=investigationRecommendation(result); assert.match(advice.reason,/not yet indexed/); assert.match(advice.actions[0].text,/review the submitted-email checks/); assert.equal(advice.actions[0].source,'search');});
test('active blocks are findings rather than execution failures; empty logs warn',async()=>{const {result}=await run({get_user_blocks:ok({has_blocks:true,block_count:1,blocks:[{identifier:'redacted',connection:null}]}),get_user_logs:ok({events:[],count:0})}); assert.equal(step(result,'blocks').state,'completed'); assert.match(step(result,'blocks').summary,/Block records/); assert.equal(step(result,'logs').state,'warning'); assert.equal(step(result,'aggregate').state,'warning');});
test('errors and malformed responses remain visible and partial evidence survives',async()=>{for(const bad of [undefined, {success:true,events:[],count:2}, {success:false,error_code:'RATE_LIMITED',retry_after_seconds:4}]){const {result}=await run({get_user_logs:bad}); assert.equal(step(result,'logs').state,'failed'); assert.equal(step(result,'blocks').state,'completed'); assert.equal(step(result,'aggregate').state,'warning'); if(bad?.error_code) assert.match(step(result,'logs').summary,/4 seconds/);}});
test('a provider-rejected log page remains a failed check, not an empty history',async()=>{
 const {result}=await run({get_user_logs:{success:false,error_code:'API_ERROR'}});
 assert.equal(step(result,'logs').state,'failed');
 assert.equal(result.accountHistory,undefined);
 assert.ok(findings(result).some(item=>item.source==='logs' && item.category==='inconclusive'));
 assert.equal(investigationRecommendation(result).status,'More evidence needed');
});
test('search and profile failures prevent dependent calls',async()=>{for(const overrides of [{search_users:{success:false,error_code:'MISSING_SCOPE'}},{get_user:{success:true,user_id:'different',blocked:false,connections:[]}}]){const {result,calls}=await run(overrides); assert.ok(!calls.includes('get_user_logs')); assert.equal(step(result,'logs').state,'skipped');}});
test('incomplete email search stops account reads and asks for a user ID',async()=>{const {result,calls}=await run({search_users:{success:false,error_code:'SEARCH_INCOMPLETE'}}); assert.deepEqual(calls,['search_users']); const advice=investigationRecommendation(result); assert.equal(advice.status,'More evidence needed'); assert.match(advice.reason,/truncated/); assert.match(advice.actions[0].text,/user ID/); assert.equal(advice.actions[0].source,'search');});
test('search and profile failures give actionable guidance without suggesting a different identity',async()=>{
 for(const [tool,response,expected] of [
  ['search_users',{success:false,error_code:'MISSING_SCOPE'},/read:users/],
  ['get_user',{success:false,error_code:'AUTHENTICATION_FAILED'},/credentials/],
  ['search_users',{success:false,error_code:'RATE_LIMITED',retry_after_seconds:12},/at least 12 seconds/],
 ]) {
  const {result}=await run({[tool]:response}); const advice=investigationRecommendation(result);
  assert.equal(advice.status,'More evidence needed'); assert.match(advice.actions[0].text,expected);
  assert.equal(advice.actions[0].source,tool==='search_users'?'search':'profile');
 }
});
test('reported account signals do not hide missing permissions or rate-limited log pages',async()=>{
 const blocked=await run({get_user:ok({user_id:'auth0|1',email:'a@example.com',blocked:true,connections:[]}),get_user_logs:{success:false,error_code:'MISSING_SCOPE'}});
 const advice=investigationRecommendation(blocked.result);
 assert.match(advice.reason,/incomplete/); assert.ok(advice.actions.some(action=>action.source==='profile' && /administrator/.test(action.text)));
 assert.ok(advice.actions.some(action=>action.source==='logs' && /read:logs_users/.test(action.text)));
 assert.match(accountCaseSummary(blocked.result,{incidentTime:'',application:'',symptom:'',ticket:''},false),/read:logs_users/);
 const timed=await run({get_user_logs:{success:false,error_code:'RATE_LIMITED',retry_after_seconds:9}});
 assert.match(investigationRecommendation(timed.result).actions.find(action=>action.source==='logs').text,/at least 9 seconds/);
});
test('independent checks overlap after profile completion',async()=>{let release; const gate=new Promise(resolve=>release=resolve); let started=[]; const client={async tool({tool}){started.push(tool); if(tool==='get_user_logs'||tool==='get_user_blocks') await gate; return base[tool];}}; const pending=executeInvestigation(createInvestigation('a@example.com'),client,'token',async()=> 'review',()=>{}); await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(started,['search_users','get_user','get_user_logs','get_user_blocks']); release(); await pending;});
test('account investigation asks for a bounded page of recent events',async()=>{const calls=[];const client={async tool(call){calls.push(call);return base[call.tool];}};const result=await executeInvestigation(createInvestigation('a@example.com'),client,'token',undefined,()=>{});assert.equal(calls.find(call=>call.tool==='get_user_logs').input.limit,50);assert.equal(step(result,'logs').evidence.input.limit,50);});
test('analysis failure preserves evidence and marks report incomplete',async()=>{const {result}=await run({},async()=>{throw Error('Model unavailable')}); assert.equal(step(result,'diagnosis').state,'failed'); assert.equal(step(result,'report').state,'warning'); assert.equal(step(result,'blocks').state,'completed');});
test('validates input and supports a direct user ID without email search',async()=>{assert.ok(validateTarget('bad input')); assert.ok(validateTarget('x@example.com\nother')); assert.equal(validateTarget('auth0|1'),undefined); const calls=[]; const client={async tool({tool}){calls.push(tool);return base[tool]}}; const result=await executeInvestigation(createInvestigation('auth0|1'),client,'token',async()=> 'review',()=>{}); assert.deepEqual(calls,['get_user','get_user_logs','get_user_blocks']); assert.equal(step(result,'search').state,'skipped');});
test('email validation matches the node input restrictions and preserves explicit user ID selection',()=>{
 for(const email of ['jane+tag@example.com','jane@example','a@x.'+'a'.repeat(63)]) assert.equal(supportedEmail(email),true,email);
 for(const email of ['ü@example.com','"jane"@example.com','jane..doe@example.com','.jane@example.com','jane.@example.com','jane@-example.com','jane@example-.com','jane@x.'+'a'.repeat(64)]) {
  assert.equal(supportedEmail(email),false,email); assert.match(validateTarget(email),/supported unquoted ASCII/);
 }
 const ambiguous='auth0|ü@example.com';
 assert.equal(targetType(ambiguous),undefined); assert.match(validateTarget(ambiguous),/Select user ID/);
 assert.equal(targetType(ambiguous,'user_id'),'user_id'); assert.equal(targetType(ambiguous,'email'),undefined);
});
test('ambiguous email-shaped identifiers require a choice and use the selected lookup',async()=>{
 const ambiguous='auth0|person@example.com';
 assert.match(validateTarget(ambiguous),/Select which kind/);
 const calls=[];
 const client={async tool({tool,input}){calls.push({tool,input}); if(tool==='search_users') return ok({users:[],count:0}); if(tool==='get_user') return ok({user_id:ambiguous,blocked:false,connections:[]}); return base[tool];}};
 await assert.rejects(()=>executeInvestigation(createInvestigation(ambiguous),client,'token',undefined,()=>{}));
 assert.equal(calls.length,0);
 await executeInvestigation(createInvestigation(ambiguous,'email'),client,'token',undefined,()=>{});
 assert.equal(calls[0].tool,'search_users'); assert.equal(calls[0].input.email,ambiguous);
 calls.length=0;
 await executeInvestigation(createInvestigation(ambiguous,'user_id'),client,'token',undefined,()=>{});
 assert.equal(calls[0].tool,'get_user'); assert.equal(calls[0].input.user_id,ambiguous);
});
test('evidence findings keep administrative and brute force blocks separate and link to their source',async()=>{const {result}=await run({get_user:ok({user_id:'auth0|1',email:'a@example.com',blocked:true,connections:[]}),get_user_logs:ok({events:[],count:0})}); const items=findings(result); assert.ok(items.some(f=>f.source==='profile'&&f.category==='confirmed'&&/administrative/.test(f.text))); assert.ok(items.some(f=>f.source==='blocks'&&f.category==='not observed')); assert.ok(items.some(f=>f.source==='logs'&&f.category==='inconclusive'));});
test('specific Auth0 event findings are grounded in returned types',async()=>{const {result}=await run({get_user_logs:ok({events:[{log_id:'1',date:null,type:'fp',description:'Failure'},{log_id:'2',date:null,type:'fu',description:'Failure'}],count:2})}); const items=findings(result).filter(f=>f.source==='logs'); assert.ok(items.some(f=>/fp \(incorrect-password\)/.test(f.text))); assert.ok(items.some(f=>/fu \(unknown-user\)/.test(f.text))); const empty=await run({get_user_logs:ok({events:[],count:0})}); assert.ok(!findings(empty.result).some(f=>/incorrect-password|unknown-user/.test(f.text)));});
test('offline example exercises real orchestration without external services',async()=>{const result=await executeInvestigation(createInvestigation(demoTarget),demoClient,'offline',demoAnalysis,()=>{}); assert.equal(step(result,'report').state,'completed'); assert.match(result.diagnosis,/Synthetic/); assert.equal(findings(result).find(f=>f.source==='logs').category,'confirmed');});
test('timeouts and thrown SDK errors do not expose sensitive exception text',async()=>{const timeout=await invokeRead({tool:()=>new Promise(()=>{})},'token','get_user',{},5); assert.match(timeout.error,/timed out/); const failed=await invokeRead({tool:async()=>{throw Error('secret access token')}},'token','get_user',{}); assert.doesNotMatch(failed.error,/secret|token/);});
test('AI analysis may be skipped while preserving evidence',async()=>{const result=await executeInvestigation(createInvestigation(demoTarget),demoClient,'offline',undefined,()=>{}); assert.equal(step(result,'diagnosis').state,'skipped'); assert.equal(step(result,'blocks').state,'completed');});
test('mismatched profile is not treated as confirmed account evidence',async()=>{const {result}=await run({get_user:ok({user_id:'different',blocked:true,connections:[]})}); assert.equal(step(result,'profile').state,'failed'); assert.deepEqual(findings(result).filter(f=>f.source==='profile').map(f=>f.category),['inconclusive']);});
test('email investigation stops when the current profile email is missing or different',async()=>{
 for(const email of [null,'other@example.com']) {
  const {result,calls}=await run({get_user:ok({user_id:'auth0|1',email,blocked:true,connections:[]})});
  assert.deepEqual(calls,['search_users','get_user']);
  assert.equal(step(result,'profile').state,'failed');
  assert.match(step(result,'profile').summary,/email is missing or differs/);
  assert.equal(step(result,'logs').state,'skipped');
  assert.deepEqual(findings(result).filter(f=>f.source==='profile').map(f=>f.category),['inconclusive']);
  assert.match(investigationRecommendation(result).actions[0].text,/user ID/);
 }
 const matched=await run({get_user:ok({user_id:'auth0|1',email:'A@EXAMPLE.COM',blocked:false,connections:[]})});
 assert.ok(matched.calls.includes('get_user_logs'));
 const calls=[];
 await executeInvestigation(createInvestigation('auth0|1'),{tool:async({tool})=>{calls.push(tool);return tool==='get_user'?ok({user_id:'auth0|1',email:null,blocked:false,connections:[]}):base[tool];}},'token',undefined,()=>{});
 assert.deepEqual(calls,['get_user','get_user_logs','get_user_blocks']);
});
test('unremarkable account checks cannot establish that no action is needed',async()=>{const {result}=await run({get_user_logs:ok({events:[{log_id:'s',date:'2026-01-01T12:00:00Z',type:'s',description:'Success'}],count:1})},undefined); const recommendation=investigationRecommendation(result); assert.equal(recommendation.status,'Cause not established'); assert.match(recommendation.reason,/outside Auth0/);});
test('case handoff preserves reported context and honest evidence limits',async()=>{const {result}=await run({get_user_logs:ok({events:[{log_id:'a',date:'2026-01-01T12:00:00Z',type:'fp',description:'failure',client_name:'Example app'},{log_id:'b',date:null,type:'s',description:'unknown time'},{log_id:'c',date:'2026-01-01T13:00:00+00:00',type:'s',description:'success'}],count:3})},undefined); const context={incidentTime:'2026-01-01T12:15:00.000Z',application:'Reported app',symptom:'Could not sign in',ticket:'SUP-3'}; assert.deepEqual(recentAccountEvents(result).map(event=>event.type),['s','fp']); const summary=accountCaseSummary(result,context,false); assert.match(summary,/Reported symptom: Could not sign in/); assert.match(summary,/Jira request supplied: SUP-3/); assert.match(summary,/do not establish complete incident history/); assert.match(summary,/does not confirm application access/); assert.match(summary,/Example app/); assert.doesNotMatch(summary,/unknown time/); assert.match(accountCaseSummary(result,context,true),/FICTIONAL EXAMPLE/);});
test('customer draft asks only for missing context and never copies account or ticket text',()=>{
 const empty={incidentTime:'',application:'',symptom:'',ticket:'private-ticket'};
 const draft=customerReplyDraft(empty,false);
 assert.match(draft,/approximate time and timezone/); assert.match(draft,/application you tried to access/); assert.match(draft,/error message you saw/);
 assert.match(draft,/do not send your password or one-time verification codes/); assert.doesNotMatch(draft,/private-ticket|root cause|resolved/i);
 const complete={incidentTime:'2026-01-01T12:00:00Z',application:'private-app',symptom:'private-details',ticket:'private-ticket'};
 const filled=customerReplyDraft(complete,false);
 assert.doesNotMatch(filled,/private|approximate time|error message you saw/); assert.match(filled,/anything has changed/);
 assert.match(customerReplyDraft(complete,true),/^\[FICTIONAL EXAMPLE — DO NOT SEND\]/);
});
test('handoff records only recognized approved checks that were not run',async()=>{
 const {result}=await run(); const context={incidentTime:'',application:'',symptom:'',ticket:''};
 const summary=accountCaseSummary(result,context,false,undefined,undefined,['tenant log search','protection check','untrusted text']);
 assert.match(summary,/APPROVED CHECKS NOT RUN[\s\S]*tenant log search[\s\S]*protection check/);
 assert.doesNotMatch(summary,/untrusted text/);
});
test('handoff separates submitted-email log results and states their limits',async()=>{
 const {result}=await run();
 const context={incidentTime:'2026-01-01T12:00:00.000Z',application:'',symptom:'',ticket:''};
 const logs={tool:'search_submitted_email_logs',status:'success',input:{start:'2026-01-01T11:00:00.000Z',end:'2026-01-01T13:00:00.000Z'},data:{events:[{date:'2026-01-01T12:00:00Z',type:'fu',client_name:'Example app'}],page_full:true,rejected:2}};
 const summary=accountCaseSummary(result,context,false,logs);
 assert.match(summary,/SUBMITTED-EMAIL TENANT LOG SEARCH/); assert.match(summary,/provider page full/);
 assert.match(summary,/Invalid email or username \(fu\)/); assert.match(summary,/does not establish the actor/);
 assert.doesNotMatch(accountCaseSummary(result,context,false),/SUBMITTED-EMAIL TENANT LOG SEARCH/);
 assert.match(accountCaseSummary(result,context,false,{tool:'search_submitted_email_logs',status:'error',error:'MISSING_SCOPE'}),/Search failed: MISSING_SCOPE/);
});
test('handoff includes identifier protection result without asserting an effective block',async()=>{
 const {result}=await run(); const context={incidentTime:'',application:'',symptom:'',ticket:''};
 const evidence={tool:'get_blocks_by_email',status:'success',observedAt:'2026-01-01T14:00:00.000Z',data:{has_blocks:true,block_count:2}};
 const summary=accountCaseSummary(result,context,false,undefined,evidence);
 assert.match(summary,/SUBMITTED-EMAIL PROTECTION CHECK[\s\S]*2 brute-force protection record/);
 assert.match(summary,/Protection response received at 2026-01-01T14:00:00.000Z \(browser clock\)/);
 assert.match(summary,/whether a particular login is effectively blocked/);
 assert.match(summary,/allowlists before an authorized administrator/);
 assert.match(identifierProtectionAdvice({status:'success',data:{has_blocks:false}}),/does not rule out/);
 assert.equal(identifierProtectionAdvice({status:'error'}),undefined);
});
test('submitted-email next steps reflect matched, empty, incomplete and unavailable checks',async()=>{
 const match={tool:'search_submitted_email_logs',status:'success',data:{events:[{type:'fu'}],page_full:false}};
 const positive={tool:'get_blocks_by_email',status:'success',data:{has_blocks:true}};
 assert.match(identifierNextSteps(match,positive).join(' '),/does not establish the actor or a unique account/);
 assert.match(identifierNextSteps(match,positive).join(' '),/allowlists before an authorized administrator/);
 assert.match(identifierNextSteps({...match,data:{events:[],page_full:true}})[0],/full provider page/);
 assert.match(identifierNextSteps({...match,data:{events:[],page_full:false}})[0],/missing events and other causes/);
 assert.match(identifierNextSteps({status:'error',error:'MISSING_SCOPE'},{status:'error',error:'MISSING_SCOPE'}).join(' '),/read:logs.*read:users/);
 assert.match(identifierNextSteps({status:'success',data:{}},{status:'success',data:{}}).join(' '),/could not be assessed/);
 const {result}=await run(); const summary=accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:''},false,match,positive);
 assert.match(summary,/SUBMITTED-EMAIL NEXT STEPS[\s\S]*does not establish the actor/);
});
test('case status incorporates submitted-email signals and retains uncertainty',async()=>{
 const {result}=await run({search_users:ok({users:[],count:0})});
 const event={tool:'search_submitted_email_logs',status:'success',data:{events:[{type:'fu'}],page_full:true,rejected:0}};
 const positive={tool:'get_blocks_by_email',status:'success',data:{has_blocks:true}};
 const status=accountCaseRecommendation(result,event,positive);
 assert.equal(status.status,'Follow-up needed'); assert.match(status.reason,/do not establish the actor, a unique account, or the cause/);
 assert.match(status.reason,/incomplete/); assert.match(status.reason,/No matching profile/);
 assert.match(accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:''},false,event,positive),/ASSESSMENT: Follow-up needed/);
 const empty={...event,data:{events:[],page_full:false,rejected:0}};
 assert.equal(accountCaseRecommendation(result,empty,{status:'success',data:{has_blocks:false}}).status,'More evidence needed');
 const normal=await run({get_user_logs:ok({events:[{log_id:'s',date:null,type:'s',description:'x'}],count:1})});
 assert.equal(accountCaseRecommendation(normal.result,{...event,data:{events:[{type:'s'}],page_full:false,rejected:0}}).status,'Cause not established');
 assert.equal(accountCaseRecommendation(normal.result,undefined,{status:'error',error:'MISSING_SCOPE'}).status,'More evidence needed');
 assert.equal(accountCaseRecommendation(normal.result,undefined,undefined,['protection check']).status,'More evidence needed');
 const priorBlocks={status:'success',data:{has_blocks:false,block_count:0,refresh_error:'RATE_LIMITED'}};
 assert.equal(accountCaseRecommendation(normal.result,undefined,priorBlocks).status,'More evidence needed');
 assert.match(identifierNextSteps(undefined,priorBlocks).join(' '),/later protection check failed.*stale/);
 assert.match(accountCaseSummary(normal.result,{incidentTime:'',application:'',symptom:'',ticket:''},false,undefined,priorBlocks),/later protection check failed: RATE_LIMITED.*stale/);
});
test('case timeline excludes failed or unvalidated log results',async()=>{const {result}=await run(); const logs=step(result,'logs'); logs.state='failed'; assert.deepEqual(recentAccountEvents(result),[]);});
test('incident time highlighting is bounded and never assumes an unspecified time',()=>{assert.equal(nearReportedTime('2026-01-01T12:00:00Z','2026-01-01T13:00:00Z'),true);assert.equal(nearReportedTime('2026-01-01T12:00:00Z','2026-01-01T13:00:01Z'),false);assert.equal(nearReportedTime('2026-01-01T12:00:00Z',''),false);});
test('application-name hints require a reported name and never establish a relationship',async()=>{
 assert.equal(matchesReportedApplication('Example App',' example app '),true);
 for(const [actual,reported] of [[null,'Example App'],['','Example App'],['Unknown application','Unknown application'],['Example App',''],['Other','Example App']]) assert.equal(matchesReportedApplication(actual,reported),false);
 const {result}=await run({get_user_logs:ok({events:[{log_id:'1',date:'2026-01-01T12:00:00Z',type:'f',description:'x',client_name:'Example App'}],count:1})});
 const context={incidentTime:'',application:'example app',symptom:'',ticket:''};
 const submitted={tool:'search_submitted_email_logs',status:'success',data:{events:[{type:'fu',client_name:'Example App'}],page_full:false,rejected:0}};
 const summary=accountCaseSummary(result,context,false,submitted);
 assert.equal((summary.match(/matches reported application name/g) ?? []).length,2);
 assert.match(summary,/names can change or be shared and do not prove the event is related/);
});
test('observed account time range and incident comparison never assert complete coverage',async()=>{
 const events=[{log_id:'1',date:'2026-01-01T10:00:00Z',type:'f',description:'x'},{log_id:'2',date:'2026-01-01T13:00:00Z',type:'s',description:'x'},{log_id:'3',date:null,type:'f',description:'x'}];
 const {result}=await run({get_user_logs:ok({events,count:3})});
 const comparison=accountTimeComparison(result,'2026-01-01T12:00:00Z');
 assert.match(comparison,/2 dated account event\(s\)/); assert.match(comparison,/2026-01-01T10:00:00.000Z to 2026-01-01T13:00:00.000Z/);
 assert.match(comparison,/1 returned event\(s\) are within one hour/); assert.match(comparison,/does not establish complete coverage/);
 assert.match(accountTimeComparison(result,'2026-01-02T12:00:00Z'),/0 returned event\(s\)/);
 assert.match(accountTimeComparison(result,''),/No valid incident time/);
 assert.match(accountCaseSummary(result,{incidentTime:'2026-01-01T12:00:00Z',application:'',symptom:'',ticket:''},false),/observed range does not establish complete coverage/);
 step(result,'logs').state='failed'; assert.match(accountTimeComparison(result,'2026-01-01T12:00:00Z'),/No dated account events.*available/);
});
test('later account success requires ordered events near the incident with the same known application name',async()=>{
 const row=(id,date,type,client_name)=>({log_id:id,date,type,description:'fixture',client_name});
 const incident='2026-01-01T12:00:00Z';
 const failed=row('f','2026-01-01T11:55:00Z','fp','Example app');
 const success=row('s','2026-01-01T12:05:00Z','s','Example app');
 const investigate=async events=>(await run({get_user_logs:ok({events,count:events.length})},undefined)).result;
 const result=await investigate([success,failed]);
 assert.deepEqual(laterAccountSuccess(result,incident),{failureTime:'2026-01-01T11:55:00.000Z',successTime:'2026-01-01T12:05:00.000Z',application:'Example app'});
 assert.match(accountCaseSummary(result,{incidentTime:incident,application:'',symptom:'',ticket:''},false),/does not establish that the events are related/);
 for (const events of [[failed,{...success,client_name:'Other app'}],[{...success,date:failed.date},failed],[{...success,client_name:null},{...failed,client_name:null}],[{...success,date:'2026-01-01T13:01:00Z'},failed]]) assert.equal(laterAccountSuccess(await investigate(events),incident),undefined);
 assert.equal(laterAccountSuccess(result,''),undefined);
 step(result,'logs').state='failed'; assert.equal(laterAccountSuccess(result,incident),undefined);
});

const fullPage = (prefix, timestamp) => Array.from({length:50}, (_,i)=>({log_id:`${prefix}-${i}`,date:new Date(Date.parse(timestamp)-i*1000).toISOString(),type:'s',description:'Success'}));
async function runHistory(pages, incidentTime, blocks = base.get_user_blocks) {
 const calls=[]; const states=[];
 const client={async tool(call){calls.push(call); if(call.tool==='get_user_logs') return pages[call.input.page ?? 0]; if(call.tool==='get_user_blocks') return blocks; return base[call.tool];}};
 const result=await executeInvestigation(createInvestigation('a@example.com'),client,'token',undefined,value=>states.push(value),{incidentTime});
 return {result,calls,states};
}
test('reported time triggers bounded older pages and surfaces their events and provenance',async()=>{
 const first=fullPage('new','2026-01-01T14:00:00Z');
 const older=[{log_id:'older',date:'2026-01-01T12:00:00Z',type:'fp',description:'Failure'},first[0]];
 const {result,calls}=await runHistory([ok({events:first,count:50}),ok({events:older,count:2})],'2026-01-01T12:00:00.000Z');
 assert.deepEqual(calls.filter(call=>call.tool==='get_user_logs').map(call=>call.input.page ?? 0),[0,1]);
 assert.equal(result.accountHistory.stop,'short_page'); assert.equal(result.accountHistory.duplicates,1);
 assert.equal(result.accountHistory.pages[1].input.page,1);
 assert.equal(recentAccountEvents(result).length,51);
 assert.ok(findings(result).some(item=>item.source==='logs'&&item.page===2&&/incorrect-password/.test(item.text)));
 assert.equal(investigationRecommendation(result).actions.find(action=>action.source==='logs').page,2);
 const summary=accountCaseSummary(result,{incidentTime:'2026-01-01T12:00:00Z',application:'',symptom:'',ticket:''},false);
 assert.match(summary,/1 duplicate event/); assert.match(summary,/\[logs page 2\]/);
});
test('MFA signals link to the returned page without claiming the reason for the reported failure',async()=>{
 const first=fullPage('new','2026-01-01T14:00:00Z');
 const older=[{log_id:'mfa',date:'2026-01-01T12:00:00Z',type:'gd_auth_failed',description:'Failure'},{log_id:'rejected',date:'2026-01-01T11:59:00Z',type:'gd_auth_rejected',description:'Rejected'}];
 const {result}=await runHistory([ok({events:first,count:50}),ok({events:older,count:2})],'2026-01-01T12:00:00Z');
 for(const type of ['gd_auth_failed','gd_auth_rejected']) assert.ok(findings(result).some(item=>item.page===2&&item.text.includes(type)));
 const recommendation=investigationRecommendation(result);
 assert.equal(recommendation.status,'Follow-up needed');
 assert.equal(recommendation.actions.find(action=>action.text.includes('MFA')).page,2);
 const handoff=accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:''},false);
 assert.match(handoff,/MFA authentication failed/); assert.match(handoff,/MFA authentication rejected/);
 assert.match(handoff,/Review the evidence before acting/);
 const empty=await run({get_user_logs:ok({events:[],count:0})},undefined);
 assert.ok(!findings(empty.result).some(item=>item.text.includes('gd_auth_')));
});
test('older-page failure preserves returned events and warns in the handoff',async()=>{
 const first=fullPage('new','2026-01-01T14:00:00Z');
 const {result}=await runHistory([ok({events:first,count:50}),{success:false,error_code:'RATE_LIMITED',retry_after_seconds:9}],'2026-01-01T12:00:00Z');
 assert.equal(result.accountHistory.stop,'read_failed'); assert.equal(step(result,'logs').state,'warning');
 assert.equal(recentAccountEvents(result).length,50);
 assert.match(accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:''},false),/RATE_LIMITED/);
});
test('account history stops without a time, after a shared failure, and on a repeated page',async()=>{
 const first=fullPage('new','2026-01-01T14:00:00Z'); const firstResponse=ok({events:first,count:50});
 for (const [time,blocks,expected] of [['',base.get_user_blocks,'no_incident_time'],['2026-01-01T12:00:00Z',{success:false,error_code:'AUTHENTICATION_FAILED'},'shared_failure']]) {
  const {result,calls}=await runHistory([firstResponse,firstResponse],time,blocks);
  assert.equal(result.accountHistory.stop,expected); assert.equal(calls.filter(call=>call.tool==='get_user_logs').length,1);
 }
 const repeated=await runHistory([firstResponse,firstResponse],'2026-01-01T12:00:00Z');
 assert.equal(repeated.result.accountHistory.stop,'repeated_page'); assert.equal(repeated.result.accountHistory.duplicates,50);
 assert.equal(recentAccountEvents(repeated.result).length,50);
});
test('block-specific scope or feature failures do not suppress independently permitted log pages',async()=>{
 const first=fullPage('new','2026-01-01T14:00:00Z');
 const older=[{log_id:'older',date:'2026-01-01T12:00:00Z',type:'fp',description:'Failure'}];
 for(const code of ['MISSING_SCOPE','FEATURE_UNAVAILABLE']) {
  const {result,calls}=await runHistory([ok({events:first,count:50}),ok({events:older,count:1})],'2026-01-01T12:00:00Z',{success:false,error_code:code});
  assert.equal(calls.filter(call=>call.tool==='get_user_logs').length,2);
  assert.equal(result.accountHistory.stop,'short_page'); assert.equal(step(result,'blocks').state,'failed');
  assert.ok(findings(result).some(item=>item.source==='logs' && item.page===2));
  assert.ok(investigationRecommendation(result).actions.some(action=>action.source==='blocks'));
 }
 for(const code of ['RATE_LIMITED','AUTHENTICATION_FAILED','AUTH0_UNAVAILABLE','API_ERROR']) {
  const {result,calls}=await runHistory([ok({events:first,count:50}),ok({events:older,count:1})],'2026-01-01T12:00:00Z',{success:false,error_code:code});
  assert.equal(calls.filter(call=>call.tool==='get_user_logs').length,1);
  assert.equal(result.accountHistory.stop,'shared_failure');
 }
});
test('evidence links ignore conflicting duplicate event IDs',()=>{
 const result=createInvestigation('a@example.com');
 const logs=step(result,'logs'),profile=step(result,'profile');
 profile.state='completed'; profile.evidence={tool:'get_user',status:'success',data:{blocked:false}};
 const page=(events)=>({tool:'get_user_logs',status:'success',data:{events,count:events.length}});
 const first=page([{log_id:'same',type:'s'}]),second=page([{log_id:'same',type:'fp'}]),third=page([{log_id:'other',type:'fp'}]);
 logs.state='completed'; logs.evidence=first; result.accountHistory={pages:[first,second,third],stop:'short_page',duplicates:1};
 assert.equal(findings(result).find(item=>/incorrect-password/.test(item.text)).page,3);
 assert.equal(investigationRecommendation(result).actions.find(action=>action.source==='logs').page,3);
});
test('account history cannot exceed five pages and rejects an oversized response',async()=>{
 const pages=Array.from({length:5},(_,i)=>ok({events:fullPage(`p${i}`,'2026-01-01T14:00:00Z'),count:50}));
 const capped=await runHistory(pages,'2026-01-01T12:00:00Z');
 assert.equal(capped.result.accountHistory.stop,'page_limit'); assert.equal(capped.calls.filter(call=>call.tool==='get_user_logs').length,5);
 const bad=await runHistory([ok({events:[...pages[0].events,pages[0].events[0]],count:51})],'2026-01-01T12:00:00Z');
 assert.equal(step(bad.result,'logs').state,'failed'); assert.deepEqual(recentAccountEvents(bad.result),[]);
});
test('account history stops at an ordered page crossing the incident window, without asserting complete coverage',async()=>{
 const first=fullPage('new','2026-01-01T14:00:00Z'), second=fullPage('old','2026-01-01T11:00:30Z');
 const {result,calls}=await runHistory([ok({events:first,count:50}),ok({events:second,count:50})],'2026-01-01T12:00:00Z');
 assert.equal(result.accountHistory.stop,'incident_window_reached'); assert.equal(calls.filter(call=>call.tool==='get_user_logs').length,2);
 assert.match(accountCaseSummary(result,{incidentTime:'2026-01-01T12:00:00Z',application:'',symptom:'',ticket:''},false),/may be missing|can be incomplete/i);
});
test('optional analysis receives each successful page without the reported time',async()=>{
 const first=fullPage('new','2026-01-01T14:00:00Z'); let received;
 const client={async tool(call){if(call.tool==='get_user_logs') return call.input.page ? ok({events:[{log_id:'older',date:'2026-01-01T12:00:00Z',type:'fp',description:'Failure'}],count:1}) : ok({events:first,count:50});return base[call.tool];}};
 await executeInvestigation(createInvestigation('a@example.com'),client,'token',async evidence=>{received=evidence;return 'analysis';},()=>{},{incidentTime:'2026-01-01T12:07:32.000Z'});
 assert.deepEqual(received.filter(item=>item.tool==='get_user_logs').map(item=>item.input.page ?? 0),[0,1]);
 assert.doesNotMatch(JSON.stringify(received),/2026-01-01T12:07:32\.000Z/);
});
test('chat retrieval stops before further account reads on identity mismatch',async()=>{for(const responses of [{...base,search_users:ok({users:[{user_id:'auth0|1',email:'other@example.com'}],count:1})},{...base,get_user:ok({user_id:'wrong',blocked:false,connections:[]})},{...base,get_user:ok({user_id:'auth0|1',email:'other@example.com',blocked:true,connections:[]})},{...base,get_user:ok({user_id:'auth0|1',email:null,blocked:true,connections:[]})}]){const calls=[];const evidence=await retrieveEvidence({tool:async({tool})=>{calls.push(tool);return responses[tool]}},'token',{email:'a@example.com'});assert.equal(calls.includes('get_user_logs'),false);if(calls.includes('get_user')){assert.equal(evidence.at(-1).status,'error');assert.equal(evidence.at(-1).data,undefined);}}});

test('workspace view separates execution from diagnostic severity and handles unknown states', async () => {
 const {stepView, createInvestigation} = await import('../src/investigation.ts');
 const steps = createInvestigation('alex@example.com').steps;
 const profile = steps.find(s=>s.id==='profile');
 assert.equal(stepView(profile).execution, 'pending');
 const blocked = {...profile,state:'completed',evidence:{tool:'get_user',status:'success',data:{blocked:true}}};
 assert.equal(stepView(blocked).execution, 'completed');
 assert.equal(stepView(blocked).severity, 'warning');
 assert.equal(stepView({...profile,state:'warning'}).execution, 'completed');
 assert.equal(stepView({...profile,state:'unexpected'}).execution, 'unknown');
 assert.deepEqual(steps.find(s=>s.id==='logs').dependencies, ['profile']);
 assert.deepEqual(steps.find(s=>s.id==='blocks').dependencies, ['profile']);
 assert.deepEqual(steps.find(s=>s.id==='aggregate').dependencies, ['logs','blocks']);
});

test('workspace evidence discards sensitive fields and redacts secrets in allowed text', async () => {
 const {safeEvidence} = await import('../src/investigation.ts');
 const safe = safeEvidence({tool:'get_user_logs',status:'success',input:{user_id:'auth0|demo',authorization:'Bearer hidden'},data:{success:true,count:1,token:'hidden',events:[{type:'f',description:'password=hunter2 Bearer abc123',secret:'hidden'}]}});
 const encoded = JSON.stringify(safe);
 assert.doesNotMatch(encoded, /hunter2|abc123|hidden/);
 assert.match(encoded, /redacted/);
 assert.equal(safe.input.user_id, 'auth0|demo');
});

test('reported problem categories give fixed review guidance without making a diagnosis', async()=>{
 for (const category of ['password','mfa','identifier','redirect']) {
  const issue=reportedIssue(category);
  assert.ok(issue?.label && issue?.advice);
  const {result}=await run();
  const summary=accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:'',issueCategory:category},false);
  assert.match(summary,/operator-reported; not confirmed by evidence/);
  assert.ok(summary.includes(issue.label) && summary.includes(issue.advice));
 }
 assert.equal(reportedIssue('unknown'),undefined);
 assert.equal(reportedIssue('__proto__'),undefined);
 assert.match(reportedIssue('password').advice,/do not request a password/);
 assert.match(reportedIssue('mfa').advice,/never request a verification code/);
});

test('MFA success alongside failure is context, not proof the events are related',async()=>{
 const event=(type,id)=>({log_id:id,date:'2026-01-01T12:00:00Z',type,description:null});
 const {result}=await run({get_user_logs:ok({events:[event('gd_auth_failed','one'),event('gd_auth_succeed','two')],count:2})},undefined);
 assert.match(mfaEvidenceCaveat(result),/MFA success event was also returned, but these events may be unrelated/);
 const handoff=accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:''},false);
 assert.match(handoff,/MFA authentication succeeded/);
 assert.match(handoff,/multiple OTP enrollments/);
 const failureOnly=await run({get_user_logs:ok({events:[event('gd_auth_failed','one')],count:1})},undefined);
 assert.match(mfaEvidenceCaveat(failureOnly.result),/one could still be missing/);
 const successOnly=await run({get_user_logs:ok({events:[event('gd_auth_succeed','two')],count:1})},undefined);
 assert.equal(mfaEvidenceCaveat(successOnly.result),undefined);
});

test('MFA OTP rate-limit evidence prompts review without assuming a current block',async()=>{
 const events=[{log_id:'otp',date:'2026-01-01T12:00:00Z',type:'gd_otp_rate_limit_exceed',description:null}];
 const {result}=await run({get_user_logs:ok({events,count:1})},undefined);
 assert.ok(findings(result).some(item=>item.text.includes('MFA OTP rate-limit') && item.page===1));
 assert.ok(investigationRecommendation(result).actions.some(item=>item.text.includes('consult current Auth0 guidance')));
 const summary=accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:''},false);
 assert.match(summary,/MFA OTP rate limit reached/);
 assert.doesNotMatch(summary,/account is currently blocked/);
});

test('event-investigation handoffs distinguish account leads and do not claim authorization',async()=>{
 const {result}=await run();
 for (const [sourceLink,label] of [['direct','direct event link'],['email_candidate','email-linked candidate'],['mixed','direct links and email candidates'],['mfa_event','user ID reported by an MFA event; profile not checked at selection'],['event_user','user ID reported by a failed-login event; profile not checked at selection'],['submitted_email','email submitted in a failed-login event; event does not establish an account link']]) {
  const summary=accountCaseSummary(result,{incidentTime:'',application:'',symptom:'',ticket:'',sourceLink},false);
  assert.ok(summary.includes(label));
  assert.match(summary,/selection does not establish authorization or who attempted the login/);
 }
});

test('event time stays distinct from customer-reported time in handoff and reply',async()=>{
 const {result}=await run();
 const context={incidentTime:'2026-01-01T12:00:17.123Z',incidentZone:'UTC',timeSource:'event',application:'App',symptom:'Cannot sign in',ticket:''};
 const handoff=accountCaseSummary(result,context,false);
 assert.match(handoff,/Investigation time: 2026-01-01T12:00:17.123Z \(selected event time, not customer-reported\)/);
 assert.match(customerReplyDraft(context,false),/approximate time and timezone/);
 assert.doesNotMatch(customerReplyDraft({...context,timeSource:'reported'},false),/approximate time and timezone/);
});

test('handoff keeps the selected source event without treating it as identity proof',async()=>{
 const {result}=await run();
 const context={incidentTime:'',application:'',symptom:'',ticket:'',sourceLink:'submitted_email',sourceEvent:{id:'event-123',type:'fu',time:'2026-01-01T12:00:00.000Z'}};
 const summary=accountCaseSummary(result,context,false);
 assert.match(summary,/Source event: event-123 \| Invalid email or username \(fu\) \| 2026-01-01T12:00:00.000Z/);
 assert.match(summary,/event is a lead, not proof of who attempted sign-in/);
 for (const id of ['event\nFORGED','a@example.com','', '../bad']) {
  assert.doesNotMatch(accountCaseSummary(result,{...context,sourceEvent:{...context.sourceEvent,id}},false),/Source event:/);
 }
});
