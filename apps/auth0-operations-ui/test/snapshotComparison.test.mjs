import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSnapshots,makeSnapshot,pendingAfterSnapshot} from '../src/snapshotComparison.ts';
const event=(id,time,kind='failure')=>({id,time,kind,category:'Failed login',app:'App'});
test('compares IDs only across overlapping snapshots and labels late events as newly seen',()=>{
 const old=makeSnapshot([{log_id:'seen'},{log_id:'other'}],[event('seen',150)],100,200);
 const current=makeSnapshot([{log_id:'seen'},{log_id:'late'},{log_id:'fresh'},{log_id:'other'}],[event('seen',150),event('late',180),event('fresh',220),event('other',225,'success')],120,240);
 assert.deepEqual(compareSnapshots(old,current),{ids:['late','fresh'],mfaIds:[],previousEnd:200});
 assert.equal(compareSnapshots(undefined,current),undefined);
 assert.equal(compareSnapshots(old,{...current,start:201}),undefined);
 assert.equal(compareSnapshots(old,{...current,start:90}),undefined);
 assert.equal(compareSnapshots(old,{...current,end:199}),undefined);
});

test('unreviewed markers survive comparable refreshes only while events remain available',()=>{
 const current=makeSnapshot([{log_id:'a'},{log_id:'b'}],[event('a',180),event('b',190)],120,240);
 assert.deepEqual(pendingAfterSnapshot(['a','gone'],{ids:['b','a'],mfaIds:[]},current),['a','b']);
 assert.deepEqual(pendingAfterSnapshot(['a'],{ids:[],mfaIds:[]},current),['a']);
 assert.deepEqual(pendingAfterSnapshot(['a'],undefined,current),[]);
 assert.deepEqual(pendingAfterSnapshot([],{ids:[],mfaIds:[]},current),[]);
});

test('newly seen MFA signals are separate from failed login events and remain markable',()=>{
 const stamp='2026-01-01T12:00:00Z', moment=Date.parse(stamp);
 const first=makeSnapshot([],[],moment-10000,moment+1000);
 const rows=[{log_id:'mfa',type:'gd_otp_rate_limit_exceed',date:stamp},{log_id:'success',type:'gd_auth_succeed',date:stamp}];
 const next=makeSnapshot(rows,[],moment-9000,moment+2000);
 const comparison=compareSnapshots(first,next);
 assert.deepEqual(comparison.ids,[]); assert.deepEqual(comparison.mfaIds,['mfa']);
 assert.deepEqual(pendingAfterSnapshot([],comparison,next),['mfa']);
 assert.deepEqual(pendingAfterSnapshot(['mfa'],{ids:[],mfaIds:[]},next),['mfa']);
 assert.deepEqual(pendingAfterSnapshot([],{ids:[],mfaIds:[]},next),[]);
});
