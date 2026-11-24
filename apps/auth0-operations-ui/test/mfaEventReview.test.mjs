import test from 'node:test';
import assert from 'node:assert/strict';
import {mfaEventAccount} from '../src/mfaEventReview.ts';
const selected={id:'event-1',type:'gd_otp_rate_limit_exceed',time:Date.parse('2026-01-01T12:00:00Z'),app:'App'};
const data={log_id:'event-1',type:'gd_otp_rate_limit_exceed',date:'2026-01-01T12:00:00Z',user_id:'auth0|123'};
test('only returns a usable account lead after matching event identity, type and time',()=>{
 assert.deepEqual(mfaEventAccount(selected,{status:'success',data}),{kind:'matched',userId:'auth0|123'});
 for(const change of [{log_id:'event-2'},{type:'gd_auth_failed'},{date:'2026-01-01T12:01:00Z'},{date:'2026-01-01T12:00:00'}]) assert.equal(mfaEventAccount(selected,{status:'success',data:{...data,...change}}).kind,'mismatch');
 for(const user_id of [null,'','not-an-id',' auth0|123']) assert.equal(mfaEventAccount(selected,{status:'success',data:{...data,user_id}}).kind,'no_user');
 assert.equal(mfaEventAccount({...selected,type:'s'},{status:'success',data}).kind,'mismatch');
 assert.equal(mfaEventAccount(selected,{status:'error'}).kind,'mismatch');
});
