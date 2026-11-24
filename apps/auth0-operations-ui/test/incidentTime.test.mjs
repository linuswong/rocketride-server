import test from 'node:test';
import assert from 'node:assert/strict';
import { localIncidentCandidates, validTimeZone } from '../src/incidentTime.ts';

test('local incident time preserves normal, skipped, and repeated clock times',()=>{
 const previous=process.env.TZ;
 try {
  process.env.TZ='America/Los_Angeles';
  assert.deepEqual(localIncidentCandidates('2026-01-01T12:00'),['2026-01-01T20:00:00.000Z']);
  assert.deepEqual(localIncidentCandidates('2026-03-08T02:30'),[]);
  assert.deepEqual(localIncidentCandidates('2026-11-01T01:30'),['2026-11-01T08:30:00.000Z','2026-11-01T09:30:00.000Z']);
  assert.deepEqual(localIncidentCandidates('2026-02-30T12:00'),[]);
  assert.deepEqual(localIncidentCandidates('2026-01-01T12:00Z'),[]);
  process.env.TZ='Australia/Lord_Howe';
  assert.deepEqual(localIncidentCandidates('2026-04-05T01:45'),['2026-04-04T14:45:00.000Z','2026-04-04T15:15:00.000Z']);
 } finally {
  if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous;
 }
});

test('an explicitly reported timezone is independent of the browser timezone',()=>{
 const previous=process.env.TZ;
 try {
  process.env.TZ='America/Los_Angeles';
  assert.deepEqual(localIncidentCandidates('2026-01-01T12:00','Asia/Tokyo'),['2026-01-01T03:00:00.000Z']);
  assert.deepEqual(localIncidentCandidates('2026-11-01T01:30','UTC'),['2026-11-01T01:30:00.000Z']);
  assert.deepEqual(localIncidentCandidates('2026-11-01T01:30','America/New_York'),['2026-11-01T05:30:00.000Z','2026-11-01T06:30:00.000Z']);
  assert.deepEqual(localIncidentCandidates('2026-03-08T02:30','America/New_York'),[]);
  assert.deepEqual(localIncidentCandidates('2026-01-01T12:00','Invalid/Timezone'),[]);
  assert.equal(validTimeZone('Invalid/Timezone'),false); assert.equal(validTimeZone('UTC'),true);
 } finally { if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous; }
});
