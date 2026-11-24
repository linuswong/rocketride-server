import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('live submitted-email check refuses incomplete or invalid authorization before connecting',()=>{
 const clean={...process.env};
 for (const key of ['LOGINLENS_LIVE_CONFIRM','LOGINLENS_TEST_EMAIL','LOGINLENS_INCIDENT_TIME','ROCKETRIDE_URI','ROCKETRIDE_APIKEY']) delete clean[key];
 const valid={LOGINLENS_LIVE_CONFIRM:'AUTHORIZED_DEVELOPMENT_TENANT_READ_ONLY',LOGINLENS_TEST_EMAIL:'private@example.com',LOGINLENS_INCIDENT_TIME:'2026-01-01T00:00:00.000Z',ROCKETRIDE_URI:'invalid://must-not-connect',ROCKETRIDE_APIKEY:'private-key'};
 for (const invalid of [{}, {...valid,LOGINLENS_LIVE_CONFIRM:'no'}, {...valid,LOGINLENS_INCIDENT_TIME:'2999-01-01T00:00:00.000Z'}, {...valid,LOGINLENS_TEST_EMAIL:'invalid'}]) {
  const result=spawnSync(process.execPath,['--experimental-strip-types','test/live-submitted-email-check.mjs'],{env:{...clean,...invalid},encoding:'utf8'});
  assert.equal(result.status,2);
  assert.match(result.stderr,/Not run/);
  assert.doesNotMatch(result.stderr,/private@example|private-key|invalid:\/\//);
 }
});
