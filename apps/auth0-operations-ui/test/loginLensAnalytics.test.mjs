import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize, otherEvents, summarize, mfaSignalLabel} from '../src/loginLensAnalytics.ts';
const now = Date.parse('2026-11-18T12:00:00Z');
const event = (id,type,date='2026-11-18T11:30:00Z') => ({log_id:id,type,date,client_name:'Example'});
test('normalizes login events, excludes duplicates and invalid or unrelated events',()=>{
 const result=normalize([event('1','s'),event('2','fp'),event('2','fp'),event('3','limit_wc'),event('4','f','bad'),event('','f'),null]);
 assert.equal(result.events.length,3); assert.equal(result.skipped,4);
 assert.deepEqual(result.events.map(e=>e.kind),['success','failure','protection']);
});
test('calculates failure rate and UTC buckets only within the requested window',()=>{
 const {events}=normalize([event('1','s'),event('2','f'),event('3','fu','2026-11-16T12:00:00Z'),event('4','f','2026-11-18T13:00:00Z')]);
 const result=summarize(events,now,24);
 assert.equal(result.selected.length,2); assert.equal(result.rate,50); assert.equal(result.categories['Failed login'],1);
 assert.equal(result.buckets.reduce((n,b)=>n+b.success+b.failure,0),2);
 assert.equal(summarize([],now,1).rate,null);
});
test('rejects timestamps without an explicit timezone',()=>{
 assert.equal(normalize([event('1','s','2026-11-18T11:30:00')]).events.length,0);
});
test('retains other event types separately from sign-in metrics',()=>{
 const rows=[event('1','mgmt_api_read'),event('2','seccft'),event('2','seccft'),event('3','s'),event('4','other','bad')];
 assert.deepEqual(otherEvents(rows).map(e=>e.type),['mgmt_api_read','seccft']);
 assert.equal(summarize(normalize(rows).events,now,24).success,1);
});

test('MFA signals stay separate from the sign-in failure rate',()=>{
 const rows=[event('1','s'),event('2','f'),event('3','gd_auth_failed'),event('4','gd_otp_rate_limit_exceed')];
 const result=summarize(normalize(rows).events,now,24);
 assert.equal(result.success,1); assert.equal(result.failure,1); assert.equal(result.rate,50);
 assert.deepEqual(otherEvents(rows).map(item=>mfaSignalLabel(item.type)),['MFA authentication failed','MFA OTP rate limit reached']);
 assert.equal(mfaSignalLabel('__proto__'),undefined);
});
