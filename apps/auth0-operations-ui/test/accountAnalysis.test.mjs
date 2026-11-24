import test from 'node:test';
import assert from 'node:assert/strict';
import { accountAnalysisPayload, accountAnalysisRecords } from '../src/accountAnalysis.ts';
import { parseAccountAnalysisResponse, parseAnalysisResponse } from '../src/analysisResponse.ts';
import { createInvestigation } from '../src/investigation.ts';

test('account AI payload omits identifiers and untrusted text while retaining bounded facts',()=>{
 const sentinel='private-identity-or-secret';
 const evidence=[
  {tool:'search_users',status:'success',input:{email:sentinel},data:{count:1,users:[{email:sentinel}]}},
  {tool:'get_user',status:'success',input:{user_id:sentinel},data:{blocked:true,email_verified:false,name:sentinel}},
  {tool:'get_user_logs',status:'success',input:{user_id:sentinel,page:1},data:{events:[{type:'fp',log_id:sentinel,client_name:sentinel,date:sentinel},{type:sentinel},{type:'s'}]}},
  {tool:'get_user_blocks',status:'success',data:{has_blocks:false,block_count:0,blocks:[{identifier:sentinel}]}},
  {tool:'get_user_logs',status:'error',error:`unexpected ${sentinel}`},
  {tool:sentinel,status:'success',data:{secret:sentinel}},
 ];
 const payload=accountAnalysisPayload(evidence,'read_failed');
 assert.doesNotMatch(JSON.stringify(payload),new RegExp(sentinel));
 assert.deepEqual(payload.checks.map(item=>item.reference),['E1','E2','E3','E4','E5']);
 assert.equal(payload.checks[2].page,2); assert.equal(payload.checks[2].event_counts.fp,1);
 assert.equal(payload.checks[2].other_events,1); assert.equal(payload.checks[4].category,'UNAVAILABLE');
 assert.equal(payload.history_stop,'read_failed');
});

test('malformed provider values cannot enter the model payload as text',()=>{
 const sentinel='private-provider-text';
 const payload=accountAnalysisPayload([
  {tool:'search_users',status:'success',data:{count:sentinel}},
  {tool:'get_user',status:'success',data:{blocked:sentinel,email_verified:sentinel}},
  {tool:'get_user_blocks',status:'success',data:{has_blocks:sentinel,block_count:sentinel}},
  {tool:'get_user_logs',status:'success',input:{page:sentinel},data:{events:[{type:sentinel}]}}
 ]);
 assert.doesNotMatch(JSON.stringify(payload),new RegExp(sentinel));
 assert.equal(payload.checks[0].count,null); assert.equal(payload.checks[1].blocked,null);
 assert.equal(payload.checks[3].page,null);
});

test('model counts exclude repeated event IDs and disclose missing identifiers',()=>{
 const first={tool:'get_user_logs',status:'success',data:{events:[{log_id:'id',type:'fp'}]}};
 const second={tool:'get_user_logs',status:'success',input:{page:1},data:{events:[{log_id:'id',type:'fp'},{log_id:null,type:'f'}]}};
 const payload=accountAnalysisPayload([first,second]);
 assert.equal(payload.checks[0].event_counts.fp,1);
 assert.equal(payload.checks[1].event_counts.fp,0);
 assert.equal(payload.checks[1].event_counts.f,1);
 assert.equal(payload.checks[1].duplicate_events,1);
 assert.equal(payload.checks[1].returned_count,2);
 assert.equal(payload.checks[1].counted_events,1);
 assert.equal(payload.checks[1].missing_event_ids,1);
 assert.doesNotMatch(JSON.stringify(payload),/"id"/);
});
test('MFA event counts remain anonymous and deduplicate across pages',()=>{
 const payload=accountAnalysisPayload([
  {tool:'get_user_logs',status:'success',data:{events:[{log_id:'private',type:'gd_auth_failed'}]}},
  {tool:'get_user_logs',status:'success',input:{page:1},data:{events:[{log_id:'private',type:'gd_auth_failed'},{log_id:'private2',type:'gd_auth_rejected'},{log_id:'private3',type:'gd_auth_succeed'},{log_id:'private4',type:'gd_otp_rate_limit_exceed'}]}}
 ]);
 assert.equal(payload.checks[0].event_counts.gd_auth_failed,1);
 assert.equal(payload.checks[1].event_counts.gd_auth_failed,0);
 assert.equal(payload.checks[1].event_counts.gd_auth_rejected,1);
 assert.equal(payload.checks[1].event_counts.gd_auth_succeed,1);
 assert.equal(payload.checks[1].event_counts.gd_otp_rate_limit_exceed,1);
 assert.match(payload.limitations,/events belong to the same attempt/);
 assert.doesNotMatch(JSON.stringify(payload),/private/);
});

test('model citations must identify successful supplied checks',()=>{
 const allowed=new Set(['E1','E3']);
 const answer=references=>JSON.stringify({takeaway:'The checks are inconclusive.',nextStep:'Review the log page.',references});
 assert.deepEqual(parseAccountAnalysisResponse(answer(['E3']),allowed).references,['E3']);
 for(const refs of [[],['E2'],['E99'],['E1','E1'],['bad'],['E1','E3','E1','E3','E1']]) assert.equal(parseAccountAnalysisResponse(answer(refs),allowed),undefined);
 assert.equal(parseAccountAnalysisResponse(JSON.stringify({takeaway:'Unknown',nextStep:null}),allowed),undefined);
 assert.equal(parseAnalysisResponse(JSON.stringify({takeaway:'Fictional',nextStep:null})).takeaway,'Fictional');
});

test('analysis references map each successful page and keep failed profile data out',()=>{
 const result=createInvestigation('person@example.com');
 const profile=result.steps.find(step=>step.id==='profile');
 profile.state='failed'; profile.evidence={tool:'get_user',status:'success',data:{blocked:true}};
 const logs=result.steps.find(step=>step.id==='logs'); logs.state='warning';
 const page0={tool:'get_user_logs',status:'success',data:{events:[],count:0}};
 const page1={tool:'get_user_logs',status:'success',input:{page:1},data:{events:[],count:0}};
 logs.evidence=page0; result.accountHistory={pages:[page0,page1],stop:'read_failed',duplicates:0,error:{tool:'get_user_logs',status:'error',error:'RATE_LIMITED'}};
 const records=accountAnalysisRecords(result);
 assert.deepEqual(records.map(item=>[item.source,item.page,item.evidence.status]),[['logs',1,'success'],['logs',2,'success'],['logs',3,'error']]);
});

test('queued, running, and skipped checks cannot become model evidence',()=>{
 const result=createInvestigation('person@example.com');
 for(const [index,state] of ['queued','running','skipped'].entries()) {
  const step=result.steps.find(item=>item.id===['search','profile','blocks'][index]);
  step.state=state; step.evidence={tool:'get_user',status:'success',data:{blocked:false}};
 }
 assert.deepEqual(accountAnalysisRecords(result),[]);
});
