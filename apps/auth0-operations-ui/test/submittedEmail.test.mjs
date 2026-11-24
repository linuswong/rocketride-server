import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSubmittedEmailPages, observedEvidence, pageObservationLines, submittedEmailWindow, submittedEmailWindowDescription, withRefreshFailure } from '../src/submittedEmail.ts';
import { invokeRead } from '../src/operations.ts';

test('reported time creates a bounded window that never extends into the future',()=>{
 const now=Date.parse('2026-01-01T12:30:00.000Z');
 assert.deepEqual(submittedEmailWindow('2026-01-01T12:00:00.000Z',now),{start:'2026-01-01T11:00:00.000Z',end:'2026-01-01T12:30:00.000Z'});
 assert.equal(submittedEmailWindow('2026-01-01T13:00:00.000Z',now),undefined);
 assert.equal(submittedEmailWindow('',now),undefined);
});

test('submitted-email search rejects malformed coverage rather than displaying it',async()=>{
 const client={tool:async()=>({success:true,events:[],count:0,page_full:'false',rejected:0})};
 const result=await invokeRead(client,'token','search_submitted_email_logs',{});
 assert.equal(result.status,'error');
 assert.match(result.error,/Malformed/);
});

test('submitted-email pages preserve provenance, deduplicate and retain prior results on failure',()=>{
 const first={tool:'search_submitted_email_logs',status:'success',input:{start:'2026-01-01T11:00:00.000Z',end:'2026-01-01T13:00:00.000Z'},data:{events:[{log_id:'a',type:'fu'}],count:1,page_full:true,rejected:49}};
 const second={tool:'search_submitted_email_logs',status:'success',data:{events:[{log_id:'a',type:'fu'},{log_id:'b',type:'fp'}],count:2,page_full:false,rejected:0}};
 const merged=mergeSubmittedEmailPages(first,[second],{status:'error',error:'RATE_LIMITED'});
 assert.deepEqual(merged.data.events.map(event=>[event.log_id,event.source_page]),[['a',1],['b',2]]);
 assert.equal(merged.data.duplicate_count,1); assert.equal(merged.data.pages_read,2); assert.equal(merged.data.additional_error,'RATE_LIMITED');
 assert.equal(mergeSubmittedEmailPages(first,[{...second,data:{...second.data,events:[{log_id:'a'}]}}]).data.repeated_page,true);
});
test('follow-up email pages must identify the requested page',async()=>{
 const base={success:true,events:[],count:0,page_full:false,rejected:0};
 for(const returned of [undefined,0,2]) {
  const client={tool:async()=>({...base,...(returned===undefined?{}:{page:returned})})};
  assert.equal((await invokeRead(client,'token','search_submitted_email_logs',{page:1})).status,'error');
 }
 const client={tool:async()=>({...base,page:1})};
 assert.equal((await invokeRead(client,'token','search_submitted_email_logs',{page:1})).status,'success');
});
test('a later refresh failure annotates prior evidence without mutating it',()=>{
 const prior={tool:'get_blocks_by_email',status:'success',data:{has_blocks:true,block_count:1}};
 const failure={tool:'get_blocks_by_email',status:'error',error:'RATE_LIMITED'};
 const marked=withRefreshFailure(prior,failure);
 assert.equal(marked.data.has_blocks,true); assert.equal(marked.data.refresh_error,'RATE_LIMITED');
 assert.equal(prior.data.refresh_error,undefined); assert.equal(withRefreshFailure(prior,undefined),prior);
});
test('page observations use local receipt times and keep each page distinct',()=>{
 const first=observedEvidence({tool:'search_submitted_email_logs',status:'success',data:{events:[],page_full:true,rejected:50}},Date.parse('2026-01-01T14:00:00Z'));
 const second=observedEvidence({tool:'search_submitted_email_logs',status:'success',data:{events:[],page_full:false,rejected:0}},Date.parse('2026-01-01T14:05:00Z'));
 assert.deepEqual(pageObservationLines(mergeSubmittedEmailPages(first,[second])),[
  'Page 1 response received at 2026-01-01T14:00:00.000Z (browser clock).',
  'Page 2 response received at 2026-01-01T14:05:00.000Z (browser clock).',
 ]);
 assert.deepEqual(pageObservationLines({data:{page_observations:[{page:99,time:'not-a-time'}]}}),[]);
});

test('search window distinguishes a shortened interval from a full requested window',()=>{
 const evidence={tool:'search_submitted_email_logs',status:'success',input:{start:'2026-01-01T11:00:00.000Z',end:'2026-01-01T12:30:00.000Z'}};
 const short=submittedEmailWindowDescription(evidence,'2026-01-01T12:00:00.000Z');
 assert.match(short,/2026-01-01T11:00:00.000Z to 2026-01-01T12:30:00.000Z/);
 assert.match(short,/later events were outside this search/);
 assert.match(short,/Different usernames, missing fields, retention or indexing can hide events/);
 const full=submittedEmailWindowDescription({...evidence,input:{...evidence.input,end:'2026-01-01T13:00:00.000Z'}},'2026-01-01T12:00:00.000Z');
 assert.doesNotMatch(full,/later events were outside/);
 assert.equal(submittedEmailWindowDescription({...evidence,status:'error'},'2026-01-01T12:00:00.000Z'),undefined);
 assert.equal(submittedEmailWindowDescription({...evidence,input:{start:'bad',end:'bad'}},''),undefined);
});
