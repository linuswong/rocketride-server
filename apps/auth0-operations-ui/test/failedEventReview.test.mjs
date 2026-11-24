import test from 'node:test';
import assert from 'node:assert/strict';
import {failedEventLead} from '../src/failedEventReview.ts';
const event={id:'event',time:Date.parse('2026-01-01T12:00:00Z'),kind:'failure',category:'Unknown user',app:'App'};
const data={log_id:'event',date:'2026-01-01T12:00:00Z',type:'fu',user_id:null,user_name:'person@example.com'};
test('only offers a submitted email after matching the selected event',()=>{
 assert.deepEqual(failedEventLead(event,{status:'success',data}),{kind:'email',value:'person@example.com'});
 assert.deepEqual(failedEventLead(event,{status:'success',data:{...data,user_id:'auth0|1'}}),{kind:'user_id',value:'auth0|1'});
 for(const change of [{log_id:'other'},{type:'fp'},{date:'2026-01-01T12:00:01Z'},{date:'2026-01-01T12:00:00'}]) assert.equal(failedEventLead(event,{status:'success',data:{...data,...change}}).kind,'mismatch');
 for(const user_name of [null,'not-an-email',' person@example.com']) assert.equal(failedEventLead(event,{status:'success',data:{...data,user_name}}).kind,'no_lead');
 assert.equal(failedEventLead({...event,category:'__proto__'},{status:'success',data}).kind,'mismatch');
});
