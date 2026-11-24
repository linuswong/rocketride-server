import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigation} from '../src/investigation.ts';
import {runOptionalIdentifierChecks} from '../src/optionalIdentifierChecks.ts';

const logs={success:true,events:[],count:0,page_full:false,rejected:0};
const blocks={success:true,has_blocks:false,block_count:0};
const time='2026-01-01T12:00:00.000Z';
function fixture(overrides={}) {
 const calls=[];
 return {calls,client:{tool:async({tool,input})=>{calls.push({tool,input});return overrides[tool] ?? (tool==='search_submitted_email_logs'?logs:blocks);}}};
}
test('runs only selected identifier checks and includes the bounded search window',async()=>{
 const account=createInvestigation('person@example.com','email');
 let {client,calls}=fixture();
 const both=await runOptionalIdentifierChecks(client,'token',account,time,{logs:true,blocks:true});
 assert.deepEqual(calls.map(call=>call.tool),['search_submitted_email_logs','get_blocks_by_email']);
 assert.equal(calls[0].input.email,'person@example.com'); assert.equal(calls[0].input.start,'2026-01-01T11:00:00.000Z');
 assert.equal(both.logs.status,'success'); assert.equal(both.blocks.status,'success'); assert.deepEqual(both.skipped,[]);
 assert.match(both.logs.observedAt,/^\d{4}-\d{2}-\d{2}T/); assert.match(both.blocks.observedAt,/^\d{4}-\d{2}-\d{2}T/);
 ({client,calls}=fixture()); await runOptionalIdentifierChecks(client,'token',account,time,{logs:false,blocks:true});
 assert.deepEqual(calls.map(call=>call.tool),['get_blocks_by_email']);
});
test('stops on shared errors and continues past independent scope failures',async()=>{
 const account=createInvestigation('person@example.com','email');
 account.steps[0].evidence={tool:'search_users',status:'error',error:'RATE_LIMITED'};
 let {client,calls}=fixture(); let result=await runOptionalIdentifierChecks(client,'token',account,time,{logs:true,blocks:true});
 assert.deepEqual(calls,[]); assert.deepEqual(result.skipped,['tenant log search','protection check']);
 account.steps[0].evidence.error='MISSING_SCOPE';
 ({client,calls}=fixture({search_submitted_email_logs:{success:false,error_code:'MISSING_SCOPE'}}));
 result=await runOptionalIdentifierChecks(client,'token',account,time,{logs:true,blocks:true});
 assert.equal(result.logs.status,'error'); assert.equal(result.blocks.status,'success'); assert.equal(calls.length,2);
 ({client,calls}=fixture({search_submitted_email_logs:{success:false,error_code:'RATE_LIMITED'}}));
 result=await runOptionalIdentifierChecks(client,'token',account,time,{logs:true,blocks:true});
 assert.deepEqual(calls.map(call=>call.tool),['search_submitted_email_logs']); assert.deepEqual(result.skipped,['protection check']);
});
test('skips a missing time without suppressing an approved protection check',async()=>{
 const {client,calls}=fixture(); const account=createInvestigation('person@example.com','email');
 const result=await runOptionalIdentifierChecks(client,'token',account,'',{logs:true,blocks:true});
 assert.deepEqual(result.skipped,['tenant log search']); assert.deepEqual(calls.map(call=>call.tool),['get_blocks_by_email']);
});
